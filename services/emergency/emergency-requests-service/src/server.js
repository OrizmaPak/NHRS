const fastify = require('fastify')({ logger: true });

const serviceName = 'emergency-requests-service';
const port = Number(process.env.PORT) || 8099;

fastify.get('/health', async () => {
  return { status: 'ok', service: serviceName };
});

const start = async () => {
  try {
    await fastify.listen({ port, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
