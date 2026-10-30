// Simple API service for testing cross-boundary tracing
import express from 'express';
import { OrderService } from '../../../packages/shared/src/services/order-service';
import { Database } from '../../../packages/shared/src/database';

const app = express();
const db = new Database();
const orderService = new OrderService(db);

// Test endpoint for cross-boundary tracing
app.get('/api/orders/:id', async (req, res) => {
  try {
    const order = await orderService.getOrder(req.params.id);
    res.json(order);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

// Test RPC endpoint
app.post('/api/orders/:id/process', async (req, res) => {
  try {
    const result = await orderService.processOrder(req.params.id);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ error: 'Failed to process order' });
  }
});

app.listen(3000, () => {
  console.log('API service running on port 3000');
});