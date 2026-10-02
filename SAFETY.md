# Safety

English | [中文](SAFETY.zh.md)

## Experimental status

DeepSeek Harness is experimental developer-preview software. It has not undergone a security audit and must not be treated as secure or production-ready.

The project can execute model-generated code and commands, load third-party plugins, and access the network, processes, credentials, and files made available to it. Incorrect model output, defects, misconfiguration, malicious input, or untrusted plugins may damage the host computer, modify or delete files, disclose data or credentials, or cause other unintended effects.

## Sandbox limitations

Sandboxing, approval prompts, and permission controls can reduce risk, but they do not guarantee isolation or prevent damage. Even correctly enforced restrictions cannot protect resources that the project is allowed to access.

Do not rely on DeepSeek Harness as the sole security control for untrusted workloads.

## Responsible use

- Run the project with the least privileges and access required.
- Prefer a disposable virtual machine, container, or dedicated environment.
- Keep backups of files that the project can access.
- Do not expose sensitive credentials or data unless you accept the risk.
- Review plugins, configuration, and proposed commands before allowing them to run.

## Finance-specific risks

FinDeck adds a finance research layer to DeepSeek Harness. The following risks belong to that layer and come in addition to the general risks above.

- **Output is not investment advice.** Reports, models, factor tests and portfolio weights come from a language model and the tools it runs. They can be wrong, and they can be confidently wrong. Nothing in the product verifies a conclusion against reality. Treat every output as research material you have to check yourself.
- **Data may be wrong, stale or biased.** Market data arrives from public interfaces (EastMoney, Sina, Yahoo, crypto exchanges) through the open-source libraries akshare, yfinance, ccxt and baostock. Sources change or throttle without notice, vendors disagree on adjustment conventions, and index membership is fetched as a current list — so any historical study built on it carries survivorship bias unless you obtain point-in-time membership yourself.
- **The research discipline is instruction, not enforcement.** The skills require residual diagnosis, out-of-sample validation, a look-ahead check and a disclaimer in every report. These are instructions to the model. No validator rejects a report that ignores them.
- **The agent can read your API keys.** Provider keys are stored in plain text in `~/.findeck/.credentials.yaml`. The agent's tools run under your user account, so they can read that file, and on Windows the mode check is skipped because the file carries no POSIX mode to inspect. Most model-driven actions pass the approval prompt; `asset_run_bg` is the exception, because it submits a detached background run into the finance Python virtual environment and answers before any result exists.
- **No trading integration.** No shipped code calls a broker or exchange order endpoint: FinDeck reads data and writes files. The finance Python environment that `asset_run` and `asset_run_bg` execute in does carry `ccxt`, an exchange client library whose API includes order placement, so code outside the shipped set is what would reach an order.
- **Backtests do not predict.** Historical performance and backtest results — including any the AI produces — do not guarantee future returns. Markets change regime, and a strategy that fit the past can fail outright.
- **Your questions go to your model provider.** Everything you ask, including the tickers, strategies and portfolio details in your prompts, is sent to whatever LLM provider you configure (DeepSeek, an OpenAI-compatible gateway, or a local server). Outside that provider, FinDeck uploads nothing anywhere: it runs no analytics, and the `/feedback` command records your remark in this session's local log without sending it to any service. Everything you ask stays between you and the provider you chose.
- **No advisory license.** FinDeck and its authors hold no investment-advisory or securities-consulting qualification in any jurisdiction; nothing here is a solicitation or a recommendation to buy or sell.

## No warranty or liability

Use DeepSeek Harness at your own risk. The software is provided without warranty under the [MIT License](LICENSE). To the maximum extent permitted by applicable law, the authors and copyright holders are not responsible for damage to computers, loss or disclosure of data, loss of files, or other harm arising from use of the project.
