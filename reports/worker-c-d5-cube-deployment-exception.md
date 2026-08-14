# D-5 · C 沙箱目标部署例外

日期：2026-08-14

目标部署：Cube 开发沙箱 `8174cc0c35a44a568688d8492fe15745`

裁定来源：Owner 已确认 D-5 目标部署就是该 C 沙箱；本报告记录分支 (b) 的书面例外与失效条件。分支 (a)“真实用户 session + workspace 权限绑定”本轮 defer。

## 书面例外

```text
本部署的唯一访问控制，是「知道那个 preview URL」。
URL 形如 https://<port>-<32位 sandbox id>.cube.app，不要求任何客户端身份。
⇒ 任何拿到该 URL 的人，都能看到该 service token 所属租户的全部 Work。
```

这是明确接受的 **security-by-obscurity** 边界。preview URL 本身就是凭据；本报告不得被解释为存在用户身份认证、内网隔离或风险可控。

## 目标部署事实表

| 项目 | 已验证事实 | 边界解释 |
|---|---|---|
| Preview URL | `https://3001-8174cc0c35a44a568688d8492fe15745.cube.app` | URL 包含端口与 32 位 sandbox ID；知道该 URL 是本部署唯一访问控制。 |
| 外部代理 | `proxyNodeIp=169.58.142.133`、`proxyPortHttps=443`、`apiSandboxDomain=cube.app`；真实响应头为 `Server: openresty` | 请求经配置的代理 IP 和 443 端口到达 OpenResty。 |
| 客户端身份 | 请求只提供服务端 CA，并用 `--resolve` 指向代理 IP；未提供客户端证书、cookie、Bearer token 或其它客户端身份 | 返回 `HTTP/1.1 502 Bad Gateway`、`curl exit0`。`502` 是因为当时端口 3001 无 listener，不是身份拒绝；该结果只证明到达代理，不证明当时数据面可读。 |
| 防火墙 | `iptables-save` 显示 `:INPUT ACCEPT [0:0]` | 盒内 INPUT 默认接受；没有发现此层客户端身份控制。 |
| 盒内网络 | `/proc/net/fib_trie` 显示 `eth0 169.254.68.6/30`，默认网关邻接地址为 `169.254.68.5` | listener 存在时，除 preview 代理路径外，还存在同盒 loopback、盒内地址及邻接代理链路的直连可能。 |

以上事实的完整原始命令、回显及“不证明公网数据读取”的限定，见独立通用事实记录 `reports/worker-c-cube-preview-exposure-fact.md`。本报告只引用该记录，不合并或改写它。

## 例外失效条件

以下任一发生，本例外立即作废，且 `C-PRODUCT-BFF-SESSION-BINDING-HG` 必须开工：

1. 部署离开该开发沙箱。
2. URL 分享给 trusted operator 之外的人，或 URL 进入任何可检索处。
3. 引入第二个 tenant 或第二个 workspace。
4. service token scope 扩大。
5. 沙箱重建导致 URL 变化；新 URL 不自动继承本例外，必须重新签署。

这些条件不是风险提示，而是例外的自动终止条件。任何触发都不得继续以“知道 URL”替代真实会话绑定。

## Defer 登记

```text
名称    C-PRODUCT-BFF-SESSION-BINDING-HG
owner   Frontend / Manager C
内容    为 /api/works/** 增加真实用户 session 与 workspace 权限绑定；未认证请求 fail closed
状态    (a) defer；本轮之后独立 slice
触发    任一例外失效条件发生即必须开工，且本 (b) 例外同时作废
```

## 本报告不授权的动作

本报告不修改 `apps/web`，不执行 route cutover，不改变沙箱、端口、iptables 或 token，也不把 security-by-obscurity 描述为内网或风险可控。Phase E 是否进入实现仍等待 Manager C 对本报告验收。
