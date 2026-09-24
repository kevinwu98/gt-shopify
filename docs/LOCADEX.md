# Running Locadex against this storefront

**Status:** the storefront's current i18n markup and French/Japanese translations were prepared manually. An actual Locadex setup or internationalization run has not been completed because model-provider credentials are missing. The wrapper below makes the follow-up reproducible; it is not a record of a successful run.

## Which Locadex this uses

The published `locadex@1.0.230` package's `start` command opens the General Translation dashboard. It does not provide the internal local agent's `auto` and `i18n` commands. Public npm does not expose `@generaltranslation/locadex-core`.

This project's `scripts/locadex.mjs` uses an existing **internal `gt-cloud/packages/locadex-core` source checkout**, with that checkout's workspace dependencies already installed. The inspected core version is `0.8.20`. It launches `src/cli.ts` with that checkout's `tsx` loader, so a compiled `dist` directory is not required. This path is for someone who already has access to the internal repository; it is not a public installation recipe.

The wrapper creates a temporary `locadex-mcp` executable, puts it on the child process's `PATH`, and removes it after the run. That executable starts the core's MCP guide/validation server. Application edits and `.locadex` run artifacts are created by Locadex in the storefront's working directory.

## Configure credentials

Run these commands from the storefront root:

```bash
cp .env.locadex.example .env.locadex
```

Edit the ignored `.env.locadex` file:

```dotenv
LOCADEX_CORE_DIR=/absolute/path/to/gt-cloud/packages/locadex-core
LOCADEX_AGENT=openai
OPENAI_API_KEY=your-provider-key
```

Alternatively use `LOCADEX_AGENT=anthropic` with `ANTHROPIC_API_KEY`. A valid internal `LOCADEX_SESSION_TOKEN` is another supported authentication mechanism, but requires the appropriate internal service configuration; an arbitrary token is not sufficient. The inspected core defaults to `gpt-5.6-sol` for OpenAI and `claude-opus-5` for Anthropic, so the selected provider must grant access to that model. An existing desktop Codex sign-in alone does not meet the core's API-key/session-token validation.

Keep provider credentials out of `.env.example`, browser code, and version control. The wrapper reads `.env.locadex` itself; it does not require exporting secret values in shell commands.

```bash
npm run locadex:check
```

This reports only source availability, runner availability, and whether the expected credential is present. It does not contact the provider or verify the key/model permissions. **The `check` command exits successfully even when configuration is incomplete; read its status lines.**

## Commands and fixed options

```bash
npm run locadex:setup
npm run locadex:i18n
```

`locadex:setup` invokes the core's `auto` command, which configures the application for i18n. `locadex:i18n` runs the separate source-internationalization workflow. Setup is already present in this POC, so the new-copy demonstration below only needs `locadex:i18n`.

Both commands use these supported internal flags:

```text
--framework react-router
--agent openai                 # or the configured anthropic provider
--package-manager npm
--local-translations
--max-concurrency 1
```

Additional flags after npm's `--` are forwarded to the core. For example:

```bash
npm run locadex:i18n -- --file-filters 'app/routes/_index.tsx'
```

The framework setting above is **Locadex's** adapter selection. If an SDK framework field is added to `gt.config.json`, the internal setup guide uses `"react"` for React Router applications; `"react-router"` is not the SDK configuration value. The current POC's GT configuration omits that optional field.

Before running an agent, save a reviewable checkpoint of the current work. The original skeleton is commit `40af3da`; that commit predates this wrapper and the GT integration. Do not reset the finished demo to it merely to run these commands.

## Reproducible new-copy demonstration

1. Confirm the current app builds, the existing translations render, and `locadex:check` reports that the source, runner, and credentials are configured.
2. Add an **unwrapped English paragraph** inside the home page JSX in `app/routes/_index.tsx`, for example:

   ```tsx
   <p>Ready for your next adventure?</p>
   ```

3. Run the actual agent on that file:

   ```bash
   npm run locadex:i18n -- --file-filters 'app/routes/_index.tsx'
   ```

4. Review the diff to confirm Locadex marked the new copy using GT APIs without changing unrelated behavior. Keep the command output/run artifacts as evidence of the actual run. A manually added `<T>` wrapper would demonstrate the SDK, not Locadex automation.
5. Extract and validate the resulting source:

   ```bash
   npm run i18n:extract
   npm run i18n:validate
   npm run typecheck
   npm test
   ```

6. Translate the new French/Japanese entries. For a **manual runtime demonstration**, edit the generated target values while retaining their generated keys and JSX structure, and label that work as manual. For an **automated GT service demonstration**, configure a GT project with `GT_PROJECT_ID` and `GT_API_KEY` in the CLI environment and run:

   ```bash
   npm run i18n:translate
   ```

   Model-provider credentials used by Locadex do not authorize GT translation service calls. Neither service authentication nor GT-generated translations has been demonstrated by the current POC.

7. Rebuild, run the production preview, and verify the new copy in all three languages:

   ```bash
   npm run build
   npm run preview:built
   ```

   In a second terminal, run `npm run test:smoke`. Inspect the new sentence directly as well; existing smoke assertions do not automatically verify newly authored copy.

This sequence separates three claims: Locadex changed the source, the GT CLI extracted valid content, and `gt-react` rendered the chosen translations. The current storefront demonstrates the latter two with manually prepared translations; the first remains a credential-dependent follow-up. It also does not establish compatibility with an older Remix 2 Hydrogen version or a deployed Oxygen environment.
