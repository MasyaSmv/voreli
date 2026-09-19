param(
    [Parameter(Mandatory = $true)]
    [string]$Method,
    [Parameter(Mandatory = $true)]
    [string]$ParamsBase64,
    [ValidateSet("page", "browser")]
    [string]$Target = "page",
    [string]$PageUrlPrefix = "http://localhost:5174"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Receive-Message([System.Net.WebSockets.ClientWebSocket]$Socket) {
    $buffer = New-Object byte[] 65536
    $segment = [ArraySegment[byte]]::new($buffer)
    $stream = [System.IO.MemoryStream]::new()
    do {
        $result = $Socket.ReceiveAsync(
            $segment,
            [System.Threading.CancellationToken]::None
        ).GetAwaiter().GetResult()
        if ($result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) {
            throw "CDP socket closed before the response arrived"
        }
        $stream.Write($buffer, 0, $result.Count)
    } while (-not $result.EndOfMessage)

    return [System.Text.Encoding]::UTF8.GetString($stream.ToArray())
}

$paramsJson = [System.Text.Encoding]::UTF8.GetString(
    [Convert]::FromBase64String($ParamsBase64)
)
$params = $paramsJson | ConvertFrom-Json

if ($Method -eq "Harness.closeOtherPages") {
    $pages = Invoke-RestMethod "http://127.0.0.1:9222/json"
    $keptTarget = $false
    foreach ($page in $pages) {
        if (-not $keptTarget -and $page.type -eq "page" -and $page.url.StartsWith($PageUrlPrefix)) {
            $keptTarget = $true
            continue
        }
        if ($page.type -eq "page") {
            Invoke-RestMethod "http://127.0.0.1:9222/json/close/$($page.id)" | Out-Null
        }
    }
    if (-not $keptTarget) {
        throw "No page target starts with $PageUrlPrefix"
    }
    Write-Output '{"id":1,"result":{}}'
    exit 0
}

$endpoint = if ($Target -eq "browser") {
    (Invoke-RestMethod "http://127.0.0.1:9222/json/version").webSocketDebuggerUrl
} else {
    $pages = Invoke-RestMethod "http://127.0.0.1:9222/json"
    $pageEndpoint = $null
    foreach ($page in $pages) {
        if ($page.type -eq "page" -and $page.url.StartsWith($PageUrlPrefix)) {
            $pageEndpoint = $page.webSocketDebuggerUrl
            break
        }
    }
    if (-not $pageEndpoint) {
        foreach ($page in $pages) {
            if ($page.type -eq "page" -and $page.url -notlike "chrome://*") {
                $pageEndpoint = $page.webSocketDebuggerUrl
                break
            }
        }
    }
    $pageEndpoint
}
if (-not $endpoint) {
    throw "No $Target CDP endpoint found"
}

$socket = [System.Net.WebSockets.ClientWebSocket]::new()
try {
    $socket.ConnectAsync(
        [Uri]$endpoint,
        [System.Threading.CancellationToken]::None
    ).GetAwaiter().GetResult() | Out-Null
    $request = @{ id = 1; method = $Method; params = $params } |
        ConvertTo-Json -Depth 20 -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($request)
    $socket.SendAsync(
        [ArraySegment[byte]]::new($bytes),
        [System.Net.WebSockets.WebSocketMessageType]::Text,
        $true,
        [System.Threading.CancellationToken]::None
    ).GetAwaiter().GetResult() | Out-Null

    while ($true) {
        $response = Receive-Message $socket | ConvertFrom-Json
        if ($response.id -eq 1) {
            $response | ConvertTo-Json -Depth 30 -Compress
            break
        }
    }
}
finally {
    $socket.Dispose()
}
