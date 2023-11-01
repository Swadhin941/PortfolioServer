const express= require("express");
const app = express();
const port = process.env.PORT || 5000;
const cors = require('cors');
require("dotenv").config();


app.use(cors());
app.use(express.json());


const { MongoClient, ServerApiVersion } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.wxzkvmx.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    const messages= client.db("Portfolio").collection("Messages");

    app.post("/post", async(req, res)=>{
        const tempMessages= req.body;
        const result = await messages.insertOne(tempMessages);
        res.send(result);
    });

  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);


app.get('/', (req, res)=>{
    res.send("Server running");
})

app.listen(port, ()=>{
    console.log('Server is running');
})