# Preparing Agent Cut for GitHub

Use this application directory as the repository root. Create a private repository for the initial source backup. `package.json` has `private: true`, which prevents accidental npm publishing; repository visibility is chosen separately in GitHub.

## Files prepared by the local audit

- `.gitignore` excludes the entire private `data/` profile, local configuration, environment files, dependencies, runtime/model files, generated evidence, work directories and root-level sample media.
- `.gitattributes` identifies source text and binary font assets and defines Windows launcher line endings.
- `config.example.json` is a credential-free template. It expects FFmpeg on PATH.

Keep application modules, UI, tests, scripts, plugin metadata, `package.json`, `package-lock.json`, the vendored caption bundle, GL shader library, WGFX runtime recipes and required fonts. Preserve `THIRD-PARTY-CAPTIONS.md`, `THIRD-PARTY-TRANSITIONS.md`, every bundled font's `OFL.txt`, modification notices and `fonts/inventory.json`.

A future checkout would install Node.js 20+ and FFmpeg, run `npm ci`, and copy `config.example.json` to `config.local.json` if the test harness needs that file. Set its FFmpeg value to the local encoder path or leave `ffmpeg` when it is on PATH. Start with `npm start` or `start.cmd`. Windows is the current desktop baseline. Chatterbox, acoustic alignment and ASR runtimes/models are separate optional installations; local configurations and recordings are not part of source control.

## Remaining work before a public, reproducible release

1. Choose the project's own license. The audit did not find a top-level project LICENSE. Third-party licenses remain applicable independently.
2. Establish redistribution permission for the WGFX-derived recipes, or replace that part of the transition library. Their documentation identifies the supplied Premiere pack, but contains no redistribution grant. The raw preset analysis is excluded; required runtime recipes remain in the candidate so the app is not silently broken.
3. Generalize machine-specific documentation/tool paths and package or generate the synthetic test input fixtures. Some tests read images from the original workspace's sibling `work/story-ui-fixtures` directory and one test uses a machine-specific Python path. Other `../../work` references are output scratch directories, not missing input assets.
4. Run installation/startup and the full suite from a separate fresh checkout after that portability work. The existing machine's passing tests are not evidence of fresh-checkout reproducibility. Historical local verification reports and screenshots are intentionally excluded from Git; older documentation may refer to those local artifacts.

The first audit is a heuristic credential-pattern scan of included text files, not a guarantee that arbitrary future files contain no secrets. Review the staged diff before publishing. Runtime tokens and private stories/voice assets are excluded by directory rules, with Git ignore matching checked in a separate temporary repository. No repository was created in this live app directory and nothing was committed, pushed or published by the audit.

GitHub documents the [100 MiB regular-Git file limit](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github) and [ignore rules](https://docs.github.com/en/get-started/git-basics/ignoring-files). The audited source candidate is well below the file limit and does not need LFS for its current contents. Future deliberate large media distribution should be handled separately.
