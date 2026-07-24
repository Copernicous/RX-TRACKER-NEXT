# Third-party notices

RX Native Softphone uses the following NuGet packages:

- `SIPSorcery` 10.0.12
- `SIPSorceryMedia.Windows` 10.0.12
- `Microsoft.Web.WebView2` 1.0.4078.44
- Transitive packages listed in `obj/project.assets.json` after restore, including the Windows audio dependency NAudio

SIPSorcery and SIPSorceryMedia.Windows identify their license as BSD-3-Clause. Their package pages and source repositories contain the authoritative copyright and license text:

- https://www.nuget.org/packages/SIPSorcery/10.0.12
- https://www.nuget.org/packages/SIPSorceryMedia.Windows/10.0.12
- https://github.com/sipsorcery-org/sipsorcery
- https://github.com/sipsorcery-org/SIPSorceryMedia.Windows

Microsoft.Web.WebView2 is distributed under the license included in its NuGet
package. RX Softphone uses the separately installed Evergreen Microsoft Edge
WebView2 Runtime to display its application-owned control window:

- https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.4078.44
- https://learn.microsoft.com/microsoft-edge/webview2/

This proof of concept has not received a legal or commercial distribution review. Before redistributing it, generate a complete dependency/license inventory and include every notice required by the packaged versions.
