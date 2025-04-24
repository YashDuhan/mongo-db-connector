require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Default root route
app.get('/', (req, res) => {
  res.json({ test: "ok" });
});

// Store active connections
const connections = {};

// Test database connection
app.post('/api/testConnection', async (req, res) => {
  const { connectionString, host, port, database, user, password } = req.body;
  
  let uri;
  let client;
  
  try {
    // Construct URI based on provided inputs
    if (connectionString) {
      uri = connectionString;
    } else {
      const authPart = user && password ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}@` : '';
      const hostPart = `${host}:${port || 27017}`;
      uri = `mongodb://${authPart}${hostPart}/${database}`;
    }
    
    client = new MongoClient(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      connectTimeoutMS: 10000,
      serverSelectionTimeoutMS: 10000
    });
    
    await client.connect();
    
    // Generate connection ID
    const connectionId = Date.now().toString();
    connections[connectionId] = { client, config: req.body, uri };
    
    res.json({ 
      success: true, 
      message: 'Connection successful',
      connectionId
    });
  } catch (error) {
    if (client) {
      await client.close();
    }
    
    res.status(400).json({
      success: false,
      message: 'Connection failed',
      error: error.message
    });
  }
});

// Get all collections for a connection
app.get('/api/tables/:connectionId', async (req, res) => {
  const { connectionId } = req.params;
  
  if (!connections[connectionId]) {
    return res.status(404).json({
      success: false,
      message: 'Connection not found'
    });
  }
  
  const { client, config } = connections[connectionId];
  
  try {
    const db = client.db(config.database);
    const collections = await db.listCollections().toArray();
    
    res.json({
      success: true,
      tables: collections.map(collection => ({
        table_schema: config.database,
        table_name: collection.name
      }))
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve collections',
      error: error.message
    });
  }
});

// Get collection data
app.get('/api/tableData/:connectionId/:schema/:table', async (req, res) => {
  const { connectionId, schema, table } = req.params;
  const { limit = 100, offset = 0 } = req.query;
  
  if (!connections[connectionId]) {
    return res.status(404).json({
      success: false,
      message: 'Connection not found'
    });
  }
  
  const { client } = connections[connectionId];
  
  try {
    const db = client.db(schema);
    const collection = db.collection(table);
    
    // Get total count
    const total = await collection.countDocuments();
    
    // Get data with pagination
    const data = await collection.find()
      .skip(parseInt(offset))
      .limit(parseInt(limit))
      .toArray();
    
    // Extract schema from the first document or provide default
    let columns = [];
    if (data.length > 0) {
      const sampleDoc = data[0];
      columns = Object.keys(sampleDoc).map(key => {
        let dataType = typeof sampleDoc[key];
        if (sampleDoc[key] instanceof ObjectId) dataType = 'objectId';
        if (sampleDoc[key] instanceof Date) dataType = 'date';
        if (Array.isArray(sampleDoc[key])) dataType = 'array';
        
        return {
          column_name: key,
          data_type: dataType
        };
      });
    }
    
    res.json({
      success: true,
      columns,
      data,
      total
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve collection data',
      error: error.message
    });
  }
});

// Close connection
app.delete('/api/connections/:connectionId', async (req, res) => {
  const { connectionId } = req.params;
  
  if (!connections[connectionId]) {
    return res.status(404).json({
      success: false,
      message: 'Connection not found'
    });
  }
  
  try {
    const { client } = connections[connectionId];
    await client.close();
    delete connections[connectionId];
    
    res.json({
      success: true,
      message: 'Connection closed successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to close connection',
      error: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 