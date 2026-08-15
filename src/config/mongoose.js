import mongoose from 'mongoose';
import { config } from './config.js';

const dbURI = config.get("dbURI");

const connectOptions = {
  maxIdleTimeMS: 10000,
  maxPoolSize: 10,
  heartbeatFrequencyMS: 10000,      // ping server every 10s to keep alive
  serverSelectionTimeoutMS: 5000,   // fail fast if no server found
  socketTimeoutMS: 45000,           // drop socket after 45s of inactivity
  bufferCommands: false,            // don't buffer — fail immediately on disconnect
};

export async function connectToDatabase() {
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

mongoose.connection.on('reconnected', () => {
  console.log('[MongoDB] Reconnected');
});

mongoose.connection.on('disconnected', () => {
  console.log('Mongoose disconnected');
});
