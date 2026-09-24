# Run Locadex on the English storefront

This project starts with ordinary English JSX and strings. There is no GT SDK integration, GT configuration, translation markup, translation bundle, or language routing. **No actual Locadex run has been completed; model-provider credentials are not configured.**

## Configure the optional local wrapper

`scripts/locadex.mjs` runs the implementation in an existing internal `gt-cloud/packages/locadex-core` checkout. That checkout needs its workspace dependencies installed. The inspected core version is `0.8.20`; source execution uses its `tsx` loader, so a compiled `dist` directory is not required.

From this storefront's root:

```bash
cp .env.locadex.example .env.locadex
```

Edit the ignored `.env.locadex` file:

```dotenv
LOCADEX_CORE_DIR=/absolute/path/to/gt-cloud/packages/locadex-core
LOCADEX_AGENT=openai
OPENAI_API_KEY=your-provider-key
```

For Anthropic, use `LOCADEX_AGENT=anthropic` and `ANTHROPIC_API_KEY` instead. The inspected core defaults to `gpt-5.6-sol` for OpenAI and `claude-opus-5` for Anthropic; your provider account needs access to the selected model. An existing desktop Codex sign-in alone does not satisfy the core's provider-key validation. An internal `LOCADEX_SESSION_TOKEN` is also recognized when the corresponding internal service is configured.

The wrapper loads `.env.locadex` automatically. Keep credentials in that ignored file, outside browser code and version control.

```bash
npm run locadex:check
```

The check reports source availability, runner availability, and whether the expected credential exists. It does not authenticate with the provider. It exits successfully even when configuration is incomplete, so read the status lines.

## Run setup, then internationalize

Save a checkpoint of the English storefront so the resulting changes are easy to review. Then run:

```bash
npm run locadex:setup
npm run locadex:i18n
```

- `locadex:setup` invokes the internal `auto` command to install/configure GT for the app's rendering model.
- `locadex:i18n` invokes the separate source-internationalization workflow to mark user-facing copy with GT APIs.

Choose your desired target languages when configuring the generated GT setup; this English baseline deliberately does not preselect them. Review the resulting configuration and diff before generating translations. Model-provider credentials for Locadex are separate from credentials for GT's translation service.

Both commands pass these supported internal flags:

```text
--framework react-router
--agent openai                 # or the configured anthropic provider
--package-manager npm
--local-translations
--max-concurrency 1
```

The wrapper creates a temporary `locadex-mcp` executable on the child process's `PATH`, then removes it after the run. Locadex's application edits and run artifacts remain in the storefront directory for review.

Additional arguments after npm's `--` are forwarded. To try source internationalization on only the home page after setup:

```bash
npm run locadex:i18n -- --file-filters 'app/routes/_index.tsx'
```

`--framework react-router` selects Locadex's adapter. If the generated SDK configuration includes a `framework` field, the internal guide uses `"react"` for React Router; the two configuration values are distinct.

## Review the result

After the agent finishes, inspect the source changes and run:

```bash
npm run typecheck
npm run build
npm run preview:built
```

In a second terminal, run `npm run test:smoke`. Inspect the browser as well, including product variants, search, and cart updates. The baseline smoke checks establish commerce behavior; they do not automatically verify languages or copy introduced by your subsequent Locadex run.

For a follow-up change demonstration, add a fresh English sentence to a page after the initial run, run `locadex:i18n` on that file, and review the new GT markup. Generating translated values is a further step using the translation workflow you configure. Keep actual agent output as evidence of automation.

## Public package versus internal agent

The inspected public `locadex@1.0.230` package's `start` command opens the General Translation dashboard; it does not expose this internal local agent's `auto` and `i18n` commands. `@generaltranslation/locadex-core` is not available from public npm. This wrapper is intended for someone with access to the existing internal checkout.

This baseline uses current Hydrogen with React Router 7. A run here does not by itself validate an older Remix 2 Hydrogen release or an Oxygen deployment.
