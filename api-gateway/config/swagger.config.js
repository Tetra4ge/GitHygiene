const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Polyglot DevOps API Gateway',
      version: '1.0.0',
      description: 'API documentation for Polyglot DevOps - A unified repository intelligence platform',
    },
    servers: [
      {
        url: 'http://localhost:4000',
        description: 'Development server',
      },
    ],
  },
  // Pointing to where your endpoints will be defined for Swagger to read the comments
  apis: ['./routes/*.js', './controllers/*.js', './docs/*.js', './server.js'],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
