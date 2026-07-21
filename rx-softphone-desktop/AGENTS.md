# RX Native Softphone project context

- This is a separate native Windows SIP softphone proof of concept. Keep it separate from RX Tracker until the user explicitly requests integration.
- Do not convert it to WebRTC and do not require WS/WSS. The native process must register directly to Asterisk with SIP over UDP.
- Default PBX: `192.168.15.200`, remote SIP port `5060`, transport UDP, media encryption disabled.
- Default test extension: `1006`. The supplied MicroSIP screenshot for `1002` is an example showing that another extension uses the same account pattern.
- Account mapping: extension number is Account Name, Username, Login, and normally Display Name. PBX address is SIP Server, SIP Proxy, and Domain.
- Registration refresh is 300 seconds. UDP keep-alive is 15 seconds and must originate from the same native SIP socket.
- Never place SIP passwords in source files, configuration, command lines, logs, screenshots, commits, or documentation. Accept them at runtime only and clear the application's reference on unregister/exit.
- Do not repeat passwords previously shared in conversation. Recommend rotating any exposed credential.
- The local control API must remain loopback-only unless the user explicitly approves a reviewed integration design.
