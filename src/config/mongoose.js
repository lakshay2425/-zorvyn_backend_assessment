import mongoose from 'mongoose';
import { config } from './config.js';

const dbURI = config.get("dbURI");

const connectOptions = {
  maxIdleTimeMS: 10000,
};

export async function connectToDatabase() {
  // 1 = connected
  if (mongoose.connection.readyState === 1) {
    return;
  }

  try {
    await mongoose.connect(dbURI, connectOptions);
    console.log('Mongoose connected');
  } catch (error) {
    console.error('Mongoose connection error:', error.message);
    throw error;
  }
}

mongoose.connection.on('error', (err) => {
  console.error('Mongoose connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.log('Mongoose disconnected');
});
