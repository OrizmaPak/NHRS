# token-service
Placeholder service for NHRS.
## Default Port
8084
## Health Check
- GET /health
"@ | Set-Content -Path "services/core-platform/authentication/token-service/README.md"
  @"
const http = require('http');
const serviceName = 'token-service';
const port = Number(process.env.PORT) || 8084;
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: serviceName }));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'not_found', service: serviceName }));
});
server.listen(port, '0.0.0.0', () => {
  console.log(${serviceName} listening on );
});
