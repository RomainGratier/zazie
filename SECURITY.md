# Security

Please report vulnerabilities privately using [GitHub private vulnerability reporting](https://github.com/RomainGratier/zazie/security/advisories/new). Include affected versions, a minimal fictional reproduction, and the impact. Do not put credentials or personal data in a report. This early project does not promise a response-time SLA.

Zazie runs on the server and sends submitted intention/data to TypeSafe for live evaluation. It does not fetch URLs in the data, execute submitted code, persist inputs, or log raw provider errors. Treat exported reports according to your own retention and access policies. Integrating systems remain responsible for what they submit and what actions they take.

The hosted model is a trust boundary. Input instructions are treated as untrusted context, but prompt design is not proof of injection resistance. Never treat a negative finding as permission to execute untrusted instructions or as a replacement for deterministic access controls. Missing evidence and failures remain explicit outcomes.

The current supported development line is 0.1.x. Dependency updates and reports of malformed input handling are welcome.
