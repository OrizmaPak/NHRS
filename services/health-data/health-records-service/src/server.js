# health-records-service
Placeholder service for NHRS.
## Default Port
8095
## Health Check
- GET /health
"@ | Set-Content -Path "services/health-data/health-records-service/README.md"
  @"
const http = require('http');
const serviceName = 'health-records-service';
const port = Number(process.env.PORT) || 8095;
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
