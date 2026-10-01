# Security

English | [中文](SECURITY.zh.md)

## Reporting a vulnerability

Report a vulnerability through GitHub's private advisory channel: open the repository's [Security tab](https://github.com/Dennisdan1104/FinDeck/security) and choose **Report a vulnerability**. That channel is visible only to the maintainer, and it is the only route — never describe an unfixed vulnerability in a public issue, a discussion, or a pull request.

Include what makes the report actionable: the release or commit you tested, the profile, plugin, or configuration involved, the steps that reproduce the problem, and the impact you observed. A report that reproduces from a fresh clone is the one that gets fixed first.

FinDeck is maintained by one person, with no security team, no response-time commitment, and no bug bounty. Reports are read and answered as time allows; an unacknowledged report is not a declined one.

## Attack surface

FinDeck is experimental developer-preview software built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It executes model-generated code and commands, loads third-party plugins, and reaches the network, the process table, the filesystem, and the credentials it is given. Read [SAFETY.md](SAFETY.md) before assessing it; the risks below are the part a security report is about.

- **Execution on the host.** The shell, terminal, filesystem, and subprocess tools run under your user account. Sandboxing and the approval prompt reduce risk without guaranteeing isolation.
- **Credentials.** Provider API keys are stored in plain text in `~/.findeck/.credentials.yaml`, and the agent's tools run with the privileges that can read that file.
- **Model-generated code.** Code a model writes runs as a real process, and a plugin or preset mounted from a `cordis.yml` can bring any capability with it.
- **Finance data and output.** Market data arrives from public interfaces through open-source libraries, and reports come from a language model. Neither is verified against reality, and neither is investment advice.

A sandbox escape, an approval or permission bypass, credential disclosure, a path traversal, or a command injection into a tool is a vulnerability. A wrong analysis, a stalled data source, or output you disagree with is a bug — report it as one.

## Disclosure

Use the private channel while the maintainer confirms the report, prepares a fix, and releases it. Coordinate any public write-up with the maintainer so a fix exists before the details do. This fork has no formal embargo policy and no CVE pipeline.
