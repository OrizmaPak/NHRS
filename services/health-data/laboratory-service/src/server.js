# laboratory-service
Placeholder service for NHRS.
## Default Port
8097
## Health Check
- GET /health
"@ | Set-Content -Path "services/health-data/laboratory-service/README.md"
  @"
const http = require('http');
const serviceName = 'laboratory-service';
const port = Number(process.env.PORT) || 8097;
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
