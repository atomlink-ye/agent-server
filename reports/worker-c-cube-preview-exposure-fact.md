# 开发沙箱外部可达事实；不是 D-5 目标部署证据

日期：2026-08-14

对象：Cube 开发沙箱 `8174cc0c35a44a568688d8492fe15745`

取证性质：基础设施只读回显；未启动应用、浏览器或构建，未修改任何基础设施配置。

## 结论

已验证 Cube 开发沙箱存在外部 preview 代理入口，请求可以到达该代理。取证时端口 `3001` 没有 listener，因此只能证明请求到达 OpenResty 代理，不能证明 Web 数据面可用、`/` 或 `/api/works/**` 可读，也不能证明公网数据读取。

若端口存在 listener，则从外部 preview 入口以及盒内直连路径到达服务是可能的。此事实只描述开发沙箱，不是 D-5 目标部署的 ingress/direct-access 证据，不能据此签收或否决 D-5 部署例外。

## 原始命令与回显

所有 `sandbox-ctl` 本地命令均显式设置：

```sh
export SANDBOX_CTL_USER_CONFIG="/Users/fanye/Library/Application Support/sandbox-ctl/config.json"
```

### 1. Preview 入口

命令：

```sh
sandbox-ctl --directory /Volumes/AgentsWorkspace/orgs/0xdtech/code/agent-server/.worktrees/mgr-frontend preview --port 3001
```

回显：

```json
{
  "port": 3001,
  "url": "https://3001-8174cc0c35a44a568688d8492fe15745.cube.app"
}
```

### 2. 本机 Cube 用户配置中的非秘密网络字段

只读取并输出 `api.url`、`network.proxyNodeIp`、`network.proxyPortHttps`、`network.apiSandboxDomain` 与 CA 路径；未读取或输出 API key。

```json
{
  "api": {
    "url": "https://api.cube.app:3443"
  },
  "network": {
    "apiNodeIp": "169.58.142.133",
    "proxyNodeIp": "169.58.142.133",
    "proxyPortHttps": "443",
    "apiSandboxDomain": "cube.app",
    "caPath": "/Volumes/AgentsWorkspace/orgs/atomlink-ye/.local/cubesandbox-rootCA.pem"
  }
}
```

### 3. 无客户端身份的代理到达性

命令只提供服务端 CA，并用 `--resolve` 将 preview hostname 指向配置中的代理 IP；没有提供客户端证书、cookie、Bearer token 或其它客户端身份。

```sh
host='3001-8174cc0c35a44a568688d8492fe15745.cube.app'
curl -sS -D - -o /dev/null --max-time 15 \
  --resolve "$host:443:169.58.142.133" \
  --cacert '/Volumes/AgentsWorkspace/orgs/atomlink-ye/.local/cubesandbox-rootCA.pem' \
  "https://$host/"
printf 'curl_exit=%s\n' "$?"
```

回显：

```text
HTTP/1.1 502 Bad Gateway
Server: openresty
Date: Fri, 14 Aug 2026 05:02:39 GMT
Content-Type: text/html
Content-Length: 154
Connection: keep-alive

curl_exit=0
```

该结果只证明 HTTPS 请求成功到达 OpenResty 代理。`502` 与同期“端口 3001 无 listener”一致；它不是应用响应，也不是数据面读取证据。

### 4. 盒内防火墙原始回显

`iptables-save` 的 filter 表原文包含：

```text
*filter
:INPUT ACCEPT [0:0]
:FORWARD DROP [0:0]
:OUTPUT ACCEPT [0:0]
```

本次没有修改、刷新或重载 iptables。

### 5. 盒内地址、邻接路径与端口状态

`/proc/net/fib_trie` 原文关键行：

```text
+-- 169.254.68.4/30
   |-- 169.254.68.4
      /30 link UNICAST
   |-- 169.254.68.6
      /32 host LOCAL
   |-- 169.254.68.7
      /32 link BROADCAST
```

`/proc/net/route` 的默认网关为十六进制小端 `0544FEA9`，即邻接地址 `169.254.68.5`。因此开发沙箱自身地址为 `169.254.68.6/30`，代理侧存在邻接链路。

检查 `/proc/net/tcp` 与 `/proc/net/tcp6` 中十六进制端口 `0BB9`（3001）时，只输出表头，没有 listener：

```text
== port 3001 listener exact ==
  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
```

据此只能说：listener 存在时，外部 preview 代理路径、同盒 loopback、盒内 `169.254.68.6:3001` 以及相邻代理链路可能到达服务。由于本次没有 listener，没有实测任何应用路径或数据读取。

### 6. 缺失工具与反代配置

盒内命令原始错误：

```text
sh: 6: ip: not found
sh: 8: ip: not found
sh: 10: ss: not found
sh: 12: ps: not found
nft:not-installed
```

常见反代配置文件检查回显：

```text
/etc/nginx/nginx.conf:missing
/etc/caddy/Caddyfile:missing
/etc/traefik/traefik.yml:missing
/etc/haproxy/haproxy.cfg:missing
```

这些缺失没有被修复或绕过；本报告不据此推断目标部署的反代、VPN、防火墙或允许用户集合。

## 基础设施处置声明

本轮仅上报事实。未改配置、未关闭或开放端口、未修改 iptables、未启动服务，也未把该开发沙箱事实冒充为 D-5 目标部署证据。
