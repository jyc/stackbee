To run locally:

```
pnpm i
pnpm run dev
```

See https://jonathanychan.com/blog/llms-struggle-to-explain-themselves for more information!

Please don't use this as an example of how to write front-end code.
I was just experimenting to see how it'd feel to avoid React.
React or at least some VDOM library would be much better.
If you wanted to stick with this approach, you should at least make it so
that rerenders don't e.g. destroy inputs, causing their state to disappear.

"No fair tennis without a net." - Kurt Vonnegut

The web app is rendered by `embed.ts`.

Global state is stored in:

- `SETTINGS`
- `STATE`

The main entry points for the web application are:

- `run()`
- `renderState()`
- `(window as any).stackbee = { ... }`

The stack language itself is implemented in `program.ts`.

To get a feel for the language check out `tests.ts` or use `stackbee.{evaluate,trace,analyze}` in your console.
