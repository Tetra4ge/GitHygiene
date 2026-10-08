const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const morgan = require('morgan');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger.config');
const { requireAuth } = require('./middlewares/auth.middleware');
const { checkHealth } = require('./controllers/health.controller');
const apiRoutes = require('./routes/index.routes');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Swagger API Documentation Route
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));


app.get('/health', checkHealth);
app.get('/api/v1/health', checkHealth);

app.get('/api/protected', requireAuth, (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Authentication successful! You have accessed a protected route.',
    user: req.user
  });
});

// Mount consolidated API routes
app.use('/api/v1', apiRoutes);

// Global Error Handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Internal Server Error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});


app.listen(PORT, () => {
  console.log(`🚀 API Gateway is running on http://localhost:${PORT}`);
});
