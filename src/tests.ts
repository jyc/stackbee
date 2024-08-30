import { Rat, SymExprSet, SymStack, eq, evaluate, evaluateSym, int, parse, unparse } from "program";

// 2(2n-1)
// ------- C_{n-1}
//  n + 1
// C_{n-1}             len 2 *
// C_{n-1} 2n          1 -
// C_{n-1} 2n-1        2 *
// C_{n-1} 2(2n-1)     *
// 2(2n-1)C_{n-1}      len 1 +

// 2(2n-1)C_{n-1} n+1  /
const CATALAN = "len 2 * 1 - 2 * * len 1 + /";
const COLLATZ = "dup 2 % bgtz 5 2 / 1 bgtz 4 3 * 1 +";

const TESTS: Array<{
  stack: Rat[];
  text: string;
  expected: Rat[];
}> = [
  {
    stack: [1, 3].map(int),
    text: "+",
    expected: [4].map(int),
  },
  {
    // swap underflow should get 0, not noop
    // used to noop, but that seems inconsistent with e.g. * underflow getting 0
    stack: [1].map(int),
    text: "swap",
    expected: [1, 0].map(int),
  },
  {
    // * underflow should get 0, not noop
    // maybe we could make it get 1?
    stack: [1].map(int),
    text: "*",
    expected: [0].map(int),
  },
  {
    // bgtz without offset should not crash
    stack: [],
    text: "bgtz",
    expected: [],
  },
  {
    // bgtz 0 should noop
    stack: [],
    text: "bgtz 0 1",
    expected: [1].map(int),
  },
  {
    // bgtz with overflowing offset should not crash
    stack: [],
    text: "bgtz 15",
    expected: [],
  },
  {
    stack: [1, 2, 3].map(int),
    text: "rot",
    expected: [2, 3, 1].map(int),
  },
  {
    stack: [1, 2, 3].map(int),
    text: "unrot",
    expected: [3, 1, 2].map(int),
  },
  {
    stack: [1, 3, 5].map(int),
    text: "unrot +",
    expected: [5, 4].map(int),
  },
  {
    stack: [1, 1, 2].map(int),
    text: CATALAN,
    expected: [1, 1, 5].map(int),
  },
  {
    stack: [1, 1, 2, 5].map(int),
    text: CATALAN,
    expected: [1, 1, 2, 14].map(int),
  },
  {
    stack: [3, 10].map(int),
    text: COLLATZ,
    expected: [3, 5].map(int),
  },
  {
    stack: [3, 10, 5].map(int),
    text: COLLATZ,
    expected: [3, 10, 16].map(int),
  },
  {
    //                         s_{n-2}
    // s_n = ( s_{n-3} + round(-------) ) * 2
    //                         s_{n-1}
    stack: [1, 2, 4, 4].map(int),
    text: "/ + 2 *",
    expected: [1, 6].map(int),
  },
  {
    // Not attached to this, but we shouldn't crash or create NaNs.
    stack: [],
    text: "%",
    expected: [0].map(int),
  },
  {
    // The negative sign should be in the numerator, not the denominator.
    stack: [],
    text: "0 1 - 3 /",
    expected: [[-1, 3]],
  },
  {
    stack: [],
    text: "1 0 /",
    expected: [0].map(int),
  },
  {
    // Weird pattern that came up during testing. 1 2 2 2 3 4 4 4 5 ...
    // If the first two terms are descending the pattern is pretty confusing.
    // 2 1 0 2 4 3 2 4 6
    stack: [1, 2, 2, 2].map(int),
    text: "- 1 - -",
    expected: [1, 3].map(int),
  },
];

const SYM_TESTS: Array<{
  text: string;
  expected: SymStack;
}> = [
  {
    text: "bgtz 4 2 1 bgtz 1 3",
    expected: { top: [[[2], [3]]], bot: [] },
  },
  {
    text: COLLATZ,
    expected: {
      top: [
        [
          [["t", 0], 3, "*", 1, "+"],
          [["t", 0], 2, "/"],
        ],
      ],
      bot: [],
    },
  },
  {
    // 0 - should be constant folded.
    text: "0 -",
    expected: {
      top: [[[["t", 0]]]],
      bot: [],
    },
  },
  {
    // 0 % should be constant folded.
    text: "0 %",
    expected: {
      top: [[[0]]],
      bot: [],
    },
  },
  {
    // x x - should be constant folded.
    text: "dup -",
    expected: {
      top: [[[0]]],
      bot: [],
    },
  },
  {
    text: "unrot",
    expected: {
      top: [],
      bot: [[[["t", 0]]]],
    },
  },
  {
    text: "1 unrot",
    expected: {
      top: [],
      bot: [[[1]]],
    },
  },
  {
    text: "1 rot",
    expected: {
      top: [[[["b", 0]]]],
      bot: [],
    },
  },
];

function runTests() {
  let passCount = 0;
  for (let i = 0; i < TESTS.length; i++) {
    const test = TESTS[i];
    const ops = parse(test.text);
    const stack = [...test.stack];
    evaluate(ops, stack);

    const symStack: SymStack = SymStack.new();
    evaluateSym(ops, symStack);

    let ok = true;

    if (stack.length !== test.expected.length) {
      console.error(`test #${i + 1} failed: length mismatch`, { ...test, actual: stack });
      ok = false;
      continue;
    }

    for (let j = 0; j < stack.length; j++) {
      if (!eq(stack[j], test.expected[j])) {
        console.error(`test #${i + 1} failed: value mismatch at index ${j}`, {
          ...test,
          actual: stack,
        });
        ok = false;
        break;
      }
    }

    if (SymStack.lenLowerBound(symStack) > stack.length) {
      console.error(`actual stack length is less than symbolic stack length lower bound`, {
        ...test,
        symStack,
        actual: stack,
      });
    }

    // TODO Check the symbolic stack against the actual stack
    // for (let e = symStack.top.length - 1; e >= 0; e--) {
    //   const a = stack.length - 1 - e;
    //   const expected = symStack.top[e];
    //   const actual = stack[a];
    //   const match = false;
    //   for (const symExpr of expected) {
    //     const symExprStack = [];
    //     const evaluated = evaluate(symExpr, symExprStack, { readSymbol(idx: number) {
    //       // TODO We'd need to be able to
    //       // - know when each s_i was created
    //       // - know which s_is correspond to len
    //       // I think we're not far from this but I'm going to punt on it for
    //       // now so I can run the benchmarks.
    //     } });
    //   }
    //   console.log({ expected, actual });
    // }

    if (ok) {
      passCount++;
    }
  }
  if (passCount < TESTS.length) {
    console.error(`🚨 ${TESTS.length - passCount}/${TESTS.length} tests failed`);
  } else {
    console.info(`🎉 all ${TESTS.length} tests passed!`);
  }
}

function runSymTests() {
  let passCount = 0;
  for (let i = 0; i < SYM_TESTS.length; i++) {
    const test = SYM_TESTS[i];
    const ops = parse(test.text);
    const stack = SymStack.new();
    evaluateSym(ops, stack);

    let ok = true;

    const verifyStack = (side: string, expected: SymExprSet[], actual: SymExprSet[]) => {
      if (actual.length !== expected.length) {
        console.error(`test #${i + 1} failed: length mismatch for ${side} stack`, {
          ...test,
          actual,
        });
        ok = false;
        return;
      }

      for (let j = 0; j < actual.length; j++) {
        // TODO use something better than JSON stringification for comparisons
        const actualUnparsed = actual[j].map(unparse).toSorted();
        const expectedUnparsed = expected[j].map(unparse).toSorted();
        if (JSON.stringify(actualUnparsed) !== JSON.stringify(expectedUnparsed)) {
          console.error(`test #${i + 1} failed: value mismatch at ${side} stack index ${j}`, {
            ...test,
            actual,
            actualUnparsed,
            expectedUnparsed,
          });
          ok = false;
          break;
        }
      }
    };

    verifyStack("top", test.expected.top, stack.top);
    verifyStack("bot", test.expected.bot, stack.bot);

    if (ok) {
      passCount++;
    }
  }
  if (passCount < SYM_TESTS.length) {
    console.error(
      `🚨 ${SYM_TESTS.length - passCount}/${SYM_TESTS.length} symbolic execution tests failed`,
    );
  } else {
    console.info(`🎉 all ${SYM_TESTS.length} symbolic execution tests passed!`);
  }
}

runTests();
runSymTests();
