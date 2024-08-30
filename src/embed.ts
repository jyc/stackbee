import YAML from "yaml";

import {
  h as libH,
  evaluateTemplate,
  lettersToInt,
  intToLetters,
  stringForError,
  mapJSON,
  JSONValue,
} from "lib";
import {
  Op,
  Rat,
  SEED_LEN,
  SymExprSet,
  SymStack,
  SymTrace,
  SymVal,
  Trace,
  evaluate,
  evaluateSym,
  hexToOps,
  makeProblemSet,
  opsToHex,
  parse,
  parseRatList,
  showRat,
  unparse,
} from "program";
import {
  State,
  EXAMPLES,
  StateProblem,
  CharlieState,
  Settings,
  DEFAULT_SETTINGS,
  decodeProblem,
  checkSettings,
  encodeProblem,
} from "state";

import styles from "embed.module.scss";

// Run tests.
import "tests";

type HAttrs = Record<string, unknown>;
type HChildren = string | Array<string | HTMLElement>;

function h(tag: string): HTMLElement;
function h(tag: string, children: string | Array<string | HTMLElement>): HTMLElement;
function h(tag: string, attrs: HAttrs, children: HChildren): HTMLElement;
function h(
  tag: string,
  attrsOrChildren: HAttrs | HChildren = [],
  maybeChildren?: HChildren | undefined,
): HTMLElement {
  let attrs: HAttrs;
  let children: HChildren;
  if (typeof attrsOrChildren === "object" && !Array.isArray(attrsOrChildren)) {
    attrs = attrsOrChildren;
    children = maybeChildren ?? [];
  } else {
    attrs = {};
    children = attrsOrChildren;
  }
  // Replace $x with styles[x].
  const t = tag.replace(/\$([a-zA-Z]+)/g, (_match, x) => styles[x]);
  return libH(t, attrs, children);
}

function sequenceForPrompt(sequence: number[]): string {
  return `${sequence.join(" ")}`;
}

function choicesForPrompt(problem: StateProblem): string {
  const choices = [];
  const incorrects = [...problem.incorrects];
  for (let i = 0; i < problem.incorrects.length + 1; i++) {
    const a = `(${intToLetters(i)})`;
    if (i === problem.correctChoiceIdx) {
      choices.push(`${a} ${sequenceForPrompt(problem.correct)}`);
    } else {
      choices.push(`${a} ${sequenceForPrompt(incorrects.shift()!.seq)}`);
    }
  }
  return choices.join("\n");
}

function alicePrompt(settings: Settings, problem: StateProblem): JSONValue[] {
  return mapJSON((v) => {
    if (typeof v !== "string") return v;
    return evaluateTemplate(v, {
      SEED_LEN,
      EXAMPLES: problem.examples.map(sequenceForPrompt).join("\n"),
      EXAMPLE_COUNT: String(problem.examples.length),
      CHOICES: choicesForPrompt(problem),
    });
  }, settings.prompts.alice) as JSONValue[];
}

function bobPrompt(
  settings: Settings,
  problem: StateProblem,
  alice: NonNullable<State["alice"]>,
): JSONValue[] {
  return mapJSON((v) => {
    if (typeof v !== "string") return v;
    return evaluateTemplate(v, {
      SEED_LEN,
      PATTERN: alice.pattern,
      CHOICES: choicesForPrompt(problem),
    });
  }, settings.prompts.bob) as JSONValue[];
}

function charliePrompt(
  settings: Settings,
  pattern: string,
  problem: StateProblem,
  choiceIdx: number,
): JSONValue[] {
  const choice =
    choiceIdx < problem.correctChoiceIdx
      ? problem.incorrects[choiceIdx].seq
      : choiceIdx === problem.correctChoiceIdx
        ? problem.correct
        : problem.incorrects[choiceIdx - 1].seq;
  return mapJSON((v) => {
    if (typeof v !== "string") return v;
    return evaluateTemplate(v, {
      SEED_LEN,
      PATTERN: pattern,
      EXAMPLES: problem.examples.map(sequenceForPrompt).join("\n"),
      CHOICE: sequenceForPrompt(choice),
    });
  }, settings.prompts.charlie) as JSONValue[];
}

function stringifyYAML(x: unknown): string {
  return YAML.stringify(x, {
    // Otherwise prompts will be stringified with double newlines, which is
    // IMO harder to read.
    blockQuote: "literal",
  });
}

let SETTINGS: Settings = DEFAULT_SETTINGS;
let STATE: State = EXAMPLES[0];

async function run(showProblem: () => void): Promise<void> {
  try {
    // Generate problem
    let problem: StateProblem;

    if (SETTINGS.problem) {
      problem = decodeProblem(SETTINGS.problem);
    } else {
      const problemSet = await makeProblemSet({
        onProgress: async () => {},
        maxEnumHexCount: Math.pow(2, 4 * SETTINGS.difficulty),
        // `problemCount` needs to big enough for us to find some incorrect choices.
        // For incorrect choices, we use programs who generated different sequences
        // on the same two seeds. The sequences just need not to be identical.
        problemCount: 16,
      });
      const problems = Object.values(problemSet);
      const problemIdx = Math.floor(Math.random() * problems.length);
      const rawProblem = problems[problemIdx];
      problem = {
        ...rawProblem,
        correctChoiceIdx: Math.floor(Math.random() * (rawProblem.incorrects.length + 1)),
      };
    }
    STATE = {
      problem,
      isRunning: true,
      runError: "",

      alice: null,
      bob: null,
      charlie: null,
    };
    showProblem();

    // Alice
    const aliceInput = alicePrompt(SETTINGS, STATE.problem);
    const { messages: aliceMessages, output: aliceOutput } = await llm(SETTINGS, aliceInput);
    const aliceChoiceIdx = parseChoice("Alice", aliceOutput);
    const pattern = parseOutput("PATTERN", aliceOutput);
    if (pattern === null) {
      throw Error("expected PATTERN in Alice's output");
    }
    STATE.alice = {
      messages: aliceMessages,
      choiceIdx: aliceChoiceIdx,
      pattern: pattern,
    };
    showProblem();

    // Bob
    const bobInput = bobPrompt(SETTINGS, STATE.problem, STATE.alice);
    const { messages: bobMessages, output: bobOutput } = await llm(SETTINGS, bobInput);
    const bobChoiceIdx = parseChoice("Bob", bobOutput);
    STATE.bob = {
      messages: bobMessages,
      choiceIdx: bobChoiceIdx,
    };
    showProblem();

    // Charlie x Alice
    const charlieAlice =
      STATE.alice.choiceIdx === null
        ? null
        : await charlie(SETTINGS, pattern, STATE.problem, STATE.alice.choiceIdx);

    // Charlie x Bob
    const charlieBob =
      STATE.bob.choiceIdx === null
        ? null
        : await charlie(SETTINGS, pattern, STATE.problem, STATE.bob.choiceIdx);

    STATE.charlie = {
      alice: charlieAlice,
      bob: charlieBob,
    };
    showProblem();
  } catch (error) {
    STATE.runError = stringForError(error);
  } finally {
    STATE.isRunning = false;
    showProblem();
  }
}

function parseOutput(marker: string, output: string): string | null {
  const regexp = new RegExp("\\b" + marker + ": (.*)");
  for (const line of output.split("\n").reverse()) {
    const matches = line.match(regexp);
    if (matches) {
      return matches[1];
    }
  }
  return null;
}

function parseChoice(name: string, output: string): number | null {
  const choice = parseOutput("MATCH", output);
  if (choice === null) throw Error(`expected MATCH in ${name}'s output`);
  // Sometimes the LLM writes stuff like:
  //   ...
  //   pattern. Therefore, our conclusion of "MATCH: NONE" is correct.'
  // After double-checking its answer. This is a hacky way to parse that.
  const cleaned = choice.replace(/[^A-Z]/g, "");
  if (cleaned === "NONE") return null;
  let choiceIdx: number;
  try {
    choiceIdx = lettersToInt(cleaned);
  } catch {
    throw Error(`expected ${name}'s choice to be (A), (B), ...; got: ${choice}`);
  }
  return choiceIdx;
}

async function charlie(
  settings: Settings,
  pattern: string,
  problem: StateProblem,
  choiceIdx: number,
): Promise<CharlieState> {
  const input = charliePrompt(settings, pattern, problem, choiceIdx);
  const { messages, output } = await llm(settings, input);
  const answer = parseOutput("ANSWER", output);
  const ok = answer === "YES";
  return {
    messages,
    consistent: ok,
  };
}

const AsyncFunction = async function () {}.constructor;

async function llm(
  settings: Settings,
  input: JSONValue[],
): Promise<{
  messages: JSONValue[];
  output: string;
}> {
  const messages = [...input];
  while (true) {
    const request: RequestInit = {
      method: settings.api.method,
      headers: settings.api.headers,
      body: evaluateTemplate(settings.api.body, { MESSAGES: messages }),
    };
    console.log("llm request", request);
    const response = await fetch(settings.api.url, request);

    let parsed: unknown;
    try {
      const parse = AsyncFunction("response", settings.api.parse);
      parsed = await parse(response);
    } catch (e) {
      console.error(e);
      throw Error("running parse failed: " + stringForError(e));
    }
    console.log("llm parsed", parsed);

    if (parsed && typeof parsed === "object" && "action" in parsed) {
      if ("append" in parsed) {
        if (Array.isArray(parsed.append)) {
          messages.push(...parsed.append);
        } else {
          console.error("expected append to be an array", parsed.append);
          throw Error("expected append to be an array");
        }
      }

      switch (parsed.action) {
        case "stop":
          if ("output" in parsed && typeof parsed.output === "string") {
            console.log("llm stop", parsed.output);
            return { messages, output: parsed.output };
          }
          break;
        case "reply":
          console.log("llm reply");
          continue;
      }
    }

    console.error("parse returned invalid value", parsed);
    throw Error("parse returned invalid value");
  }
}

function renderState(state: State, show: () => void): HTMLElement {
  console.log("renderState", structuredClone(state));

  const settingsError = checkSettings(SETTINGS);
  if (settingsError !== null) {
    console.error(settingsError);
  }

  // Settings panel
  let wasSettingsInputTouched = false;
  const settingsInputEl = h(
    `textarea.$settingsInput`,
    { onchange: () => (wasSettingsInputTouched = true) },
    stringifyYAML(SETTINGS),
  );
  function trySaveSettings() {
    wasSettingsInputTouched = false;
    try {
      const settings = YAML.parse((settingsInputEl as HTMLTextAreaElement).value);
      const error = checkSettings(settings);
      if (error !== null) {
        throw Error(error);
      }
      console.log("updating settings", settings);
      SETTINGS = settings;
    } catch (e) {
      alert(e);
      throw e;
    }
  }
  const encodedProblem = encodeProblem(state.problem);
  const encodedProblemEl = h("code", encodedProblem);
  const settingsEl = h(`div.$settings.$displayNone`, [
    h("ul", [
      h(
        "li",
        "Settings aren't saved or transmitted anywhere. When you refresh the page, they disappear forever!",
      ),
      h("li", [
        h("strong", "BE CAREFUL!"),
        " Templates, the LLM response parser, and the LLM (via tool use) all execute arbitrary code in your browser! I am not responsible if an LLM uses this to gain control of your computer!",
      ]),
      h("li", [
        h("strong", "DO NOT"),
        " plug your own API keys or private data into settings given to you by other people!",
      ]),
      h("li", [
        "To run a specific problem, add a top-level key ",
        h("code", "problem"),
        " set to the problem ID.",
        ...(encodedProblem === SETTINGS.problem
          ? []
          : [" The current problem ID is: ", encodedProblemEl]),
      ]),
    ]),
    settingsInputEl,
    h(
      `div.$error` + (settingsError !== null ? "" : `.$displayNone`),
      `Invalid settings: ${settingsError}`,
    ),
    h(
      `button.$button`,
      {
        onclick() {
          trySaveSettings();
          // TODO I think ideally this would re-render only the settings panel
          // to update the "the current problem ID" text in-place. But we
          // currently destroy/recreate all the elements, so it closes the
          // <details> element! That seems OK for now though.
          show();
        },
      },
      "Save",
    ),
  ]);

  const isSettingsPanelDisplayed = () => !settingsEl.classList.contains(styles.displayNone);
  const isRunButtonDisabled = (state: State) => state.isRunning || settingsError !== null;

  function toggleSettingsPanel(force?: boolean) {
    if (isSettingsPanelDisplayed() && wasSettingsInputTouched) {
      trySaveSettings();
      show();
    } else {
      settingsEl.classList.toggle(styles.displayNone, force);
    }
  }

  // Run
  const runButtonEl = h(
    `button.$button`,
    {
      onclick() {
        if (settingsError !== null) {
          toggleSettingsPanel(true);
        } else {
          if (isSettingsPanelDisplayed()) {
            trySaveSettings();
          }
          run(showProblem);
        }
      },
      disabled: isRunButtonDisabled(state),
    },
    "Run",
  );

  const runErrorsEl = h(
    `div.$error` + (state.runError !== "" ? "" : `.$displayNone`),
    `Run failed: ${state.runError}`,
  );

  const problemEl = h("div.$problem", renderProblem(state, state.problem));

  const showProblem = () => {
    console.log("showProblem", structuredClone(STATE));

    runButtonEl.toggleAttribute("disabled", isRunButtonDisabled(STATE));

    runErrorsEl.textContent = STATE.runError;
    runErrorsEl.classList.toggle(styles.displayNone, STATE.runError === "");

    encodedProblemEl.textContent = encodeProblem(STATE.problem);

    // Save the IDs of <details> elements that are open so that we can restore
    // them.
    const openDetails = new Set<string>();
    problemEl.querySelectorAll(`details[open]`).forEach((el) => {
      openDetails.add(el.id);
    });

    problemEl.replaceChildren(...renderProblem(STATE, STATE.problem));

    problemEl.querySelectorAll<HTMLDetailsElement>("details").forEach((el) => {
      el.toggleAttribute("open", openDetails.has(el.id));
    });
  };

  return h(`div.$embed`, [
    // Examples states
    h(`div.$row`, [
      h(`div.$rowLabel`, "Examples"),
      ...EXAMPLES.map((_example, i) =>
        h(
          `button.$lightButton`,
          {
            onclick() {
              STATE = EXAMPLES[i];
              show();
            },
          },
          `#${i + 1}`,
        ),
      ),
    ]),

    // Controls
    h(`div.$row`, [
      runButtonEl,
      //h(`div.${styles.spacer}`),
      h(
        `button.$button`,
        {
          onclick() {
            toggleSettingsPanel();
          },
        },
        "Settings",
      ),
    ]),

    runErrorsEl,

    // Settings panel
    settingsEl,

    // Problem
    problemEl,
  ]);
}

function renderProblem(state: State, problem: StateProblem): Array<string | HTMLElement> {
  console.log("renderProblem", structuredClone(state), structuredClone(problem));

  const ops = hexToOps(problem.hex);
  const unparsed = unparse(ops);

  const symTrace: SymTrace[] = [];
  const stack: SymStack = SymStack.new();
  evaluateSym(ops, stack, {
    trace(ops: Op[], stack: SymStack) {
      symTrace.push({ ops, stack });
    },
  });
  symTrace.push({ ops: [], stack });

  const choices = [];
  const incorrects = [...problem.incorrects];
  for (let i = 0; i < problem.incorrects.length + 1; i++) {
    if (i === problem.correctChoiceIdx) {
      choices.push(renderSequence(state, problem.correct, i));
    } else {
      choices.push(renderSequence(state, incorrects.shift()!.seq, i));
    }
  }

  function matchesThePattern(
    name: "Alice" | "Bob",
    consistent: boolean,
    correct: boolean,
    choiceIdx: number | null,
  ): HTMLElement {
    const match = consistent ? "match" : "do not match";
    const evenThough = !(consistent && !correct)
      ? ""
      : `, even though the choice (${choiceIdx === null ? "no match" : intToLetters(choiceIdx)}) is wrong`;
    return h("li", [
      renderRobot(name),
      `'s choice and the example sequences `,
      h("strong", match),
      " the pattern",
      evenThough,
    ]);
  }

  const isAliceRight = state.alice?.choiceIdx === state.problem.correctChoiceIdx;
  const isBobRight = state.bob?.choiceIdx === state.problem.correctChoiceIdx;
  const isBobSameAsAlice = state.bob?.choiceIdx === state.alice?.choiceIdx;
  return [
    // Problem ID
    //h(`div.$textRow`, [h(`div.$rowLabel`, "Problem"), h(`div.$fontMono`, encodeProblem(problem))]),

    // Program
    h(`div.$textRow`, [
      h(`div.$rowLabel`, "Program"),
      h(`div.$programUnparsed`, unparsed),
      h(`div.$fontMono`, `(${problem.hex})`),
    ]),

    // Analysis
    h(`div.$textRow`, [
      h(`div.$rowLabel`, "Analysis"),
      h(`details.$details`, [
        h(`summary`, [
          h(
            `span.$symStack`,
            {},
            !stack.top.length ? "⋯" : SymExprSet.show(stack.top[stack.top.length - 1]),
          ),
        ]),
        // Analysis (as table)
        h(`table.$symTrace`, [
          h("thead", [h("tr", [h("th", "Stack"), h("th", "Ops")])]),
          h(
            `tbody`,
            symTrace.map(({ ops, stack }) =>
              h(`tr`, [h(`td.$symStack`, SymStack.show(stack)), h(`td.$opsTrace`, unparse(ops))]),
            ),
          ),
        ]),
      ]),
    ]),

    renderComments(state.comments),

    // Examples
    h(`div.$description`, [
      h(
        "strong",
        `Here are ${problem.examples.length} number sequences that follow a common pattern:`,
      ),
      h(
        `ul.$examples`,
        problem.examples.map((s) => renderSequence(state, s)),
      ),
    ]),

    // Choices
    h(`div.$description`, {}, [
      h("div", [
        h("strong", {}, `Which one of the following sequences follows the same pattern?`),
        ` The right answer is (${intToLetters(state.problem.correctChoiceIdx)}).`,
      ]),
      h(`ol.$choices`, {}, choices),
    ]),

    // Alice
    state.alice === null
      ? h(`div`, [renderLoading(), renderRobot("Alice"), " says..."])
      : h(`details#alice.$details`, [
          h(`summary`, [
            state.alice.choiceIdx === state.problem.correctChoiceIdx
              ? renderRight()
              : renderWrong(),
            renderRobot("Alice"),
            " says ",
            h(
              `strong`,
              state.alice.choiceIdx === null
                ? "no sequences match"
                : `(${intToLetters(state.alice.choiceIdx)})`,
            ),
            ", which is ",
            state.alice.choiceIdx === state.problem.correctChoiceIdx ? "right" : "wrong",
            ", and that the pattern is:",
          ]),
          h(`pre`, [stringifyYAML(state.alice.messages)]),
        ]),

    state.alice === null ? "" : h(`div.$textRow.$pattern`, state.alice.pattern),

    renderComments(state.aliceComments),

    // Bob
    state.bob === null
      ? h(`div`, [renderLoading(), renderRobot("Bob"), " says..."])
      : h(`details#bob.$details`, [
          h(`summary`, [
            isBobRight && isBobSameAsAlice ? renderRight() : renderWrong(),
            renderRobot("Bob"),
            " says ",
            renderRobot("Alice"),
            "'s pattern matches ",
            h(
              `strong`,
              state.bob.choiceIdx === null
                ? "no sequence"
                : `(${intToLetters(state.bob.choiceIdx)})`,
            ),
            ...(state.bob.choiceIdx === null
              ? ["."]
              : [
                  ", which is ",
                  isBobRight ? "right" : "wrong",
                  ", and ",
                  isBobSameAsAlice ? "the same as " : "different from ",
                  renderRobot("Alice"),
                  ".",
                ]),
          ]),
          h(`pre`, [stringifyYAML(state.bob.messages)]),
        ]),

    renderComments(state.bobComments),

    // Charlie (the Checker)
    ...(state.charlie === null
      ? [h(`div`, [renderLoading(), renderRobot("Charlie"), " says..."])]
      : state.charlie.alice === null && state.charlie.bob === null
        ? []
        : [
            h(`details#charlie.$details`, [
              h(`summary`, [
                (state.charlie.alice?.consistent ?? true) && (state.charlie.bob?.consistent ?? true)
                  ? renderRight()
                  : renderWrong(),
                renderRobot("Charlie"),
                " says:",
              ]),
              h(`pre`, [
                stringifyYAML({
                  alice: state.charlie.alice === null ? null : state.charlie.alice.messages,
                  bob: state.charlie.bob === null ? null : state.charlie.bob.messages,
                }),
              ]),
            ]),
            h("ul.$charlieMatches", [
              state.charlie.alice === null
                ? ""
                : matchesThePattern(
                    "Alice",
                    state.charlie.alice.consistent,
                    isAliceRight,
                    state.alice!.choiceIdx,
                  ),
              state.charlie.bob === null
                ? ""
                : matchesThePattern(
                    "Bob",
                    state.charlie.bob.consistent,
                    isBobRight,
                    state.bob!.choiceIdx,
                  ),
            ]),
          ]),

    renderComments(state.charlieComments),
  ];
}

function renderComments(comments?: string): HTMLElement | string {
  return !comments ? "" : h(`div.$textRow.$comments`, "Note: " + comments);
}

function renderRobot(robot: "Alice" | "Bob" | "Charlie"): HTMLElement {
  const icon = h(`span.$robotIcon`);
  icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-bot"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>`;
  return h(`span.${styles.robot}.${styles[robot]}`, [icon, robot]);
}

function renderWrong(): HTMLElement {
  const out = h(`span.$wrongIcon`);
  out.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-circle-x"><title>Wrong</title><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>`;
  return out;
}

function renderRight(): HTMLElement {
  const out = h(`span.$rightIcon`);
  out.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check"><title>Right</title><path d="M20 6 9 17l-5-5"/></svg>`;
  return out;
}

function renderLoading(): HTMLElement {
  const out = h(`span.$loadingIcon`);
  out.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-hourglass"><title>Loading</title><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg>`;
  return out;
}

function renderSequence(state: State, seq: number[], choiceIdx?: number): HTMLElement {
  const correct = choiceIdx === state.problem.correctChoiceIdx;
  return h(`li`, {}, [
    choiceIdx === undefined ? "" : h(`span.$sequenceIdx`, `(${intToLetters(choiceIdx)})`),
    h(
      `span.$sequence` + (correct ? `.$correct` : ""),
      {},
      seq.flatMap((s, i) => [
        h(`span.$sequent`, String(s)),
        i === seq.length - 1 ? "" : h(`span.$invisible`, ","),
      ]),
    ),
    h("span.$robotList", [
      !state.alice || choiceIdx !== state.alice?.choiceIdx ? "" : renderRobot("Alice"),
      !state.bob || choiceIdx !== state.bob?.choiceIdx ? "" : renderRobot("Bob"),
    ]),
  ]);
}

(window as any).stackbee = {
  render(element: HTMLElement) {
    const show = () => {
      element.replaceChildren(renderState(STATE, show));
    };
    show();
  },
  fromHex(hex: string): string {
    return unparse(hexToOps(hex));
  },
  toHex(program: string) {
    return opsToHex(parse(program));
  },
  evaluate(program: string, input: string, { showTrace }: { showTrace?: boolean } = {}) {
    const ops = parse(program);
    const stack = parseRatList(input);
    const trace: Trace[] = [];
    evaluate(ops, stack, {
      trace(ops: SymVal[], stack: Rat[]) {
        trace.push({ ops, stack });
      },
    });
    trace.push({ ops: [], stack });
    if (showTrace) {
      console.table(
        trace.map((trace) => ({
          stack: trace.stack.map(showRat).join(" "),
          ops: unparse(trace.ops),
        })),
      );
    }
    return stack.map(showRat).join(" ");
  },
  trace(program: string, input: string) {
    return this.evaluate(program, input, { showTrace: true });
  },
  analyze(program: string) {
    const ops = parse(program);
    const trace: SymTrace[] = [];
    const stack: SymStack = SymStack.new();
    evaluateSym(ops, stack, {
      trace(ops: Op[], stack: SymStack) {
        trace.push({ ops, stack });
      },
    });
    trace.push({ ops: [], stack });
    console.table(
      trace.map((trace) => ({
        stack: SymStack.show(trace.stack),
        ops: unparse(trace.ops),
      })),
    );
    return SymStack.show(stack);
  },
  dumpState() {
    console.log("Use copy(stackbee.dumpState()) to copy to the clipboard.");
    return JSON.stringify(STATE);
  },
};

// Test {encode,decode}Problem

let ok = true;
for (const example of EXAMPLES) {
  const problem = example.problem;
  const encoded = encodeProblem(problem);
  if (encodeProblem(decodeProblem(encoded)) !== encoded) {
    ok = false;
    console.error("{encode,decodeProblem} round-trip failed", problem, encoded);
  }
}
if (ok) {
  console.log("{encode,decode}Problem round-trip OK");
}
