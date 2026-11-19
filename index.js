import express from "express";
import cors from 'cors';
import 'dotenv/config';
import { MongoClient, ObjectId } from "mongodb";

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const client = new MongoClient(process.env.MONGODB_SERVER_URL);


export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

const mongoClient = await connectToMongoDB()
const db = mongoClient.db("vividspaces")
const studioCollection = db.collection('studios');



app.get("/", (req, res) => {
  res.send("Hello World from PH..");
});


app.post("/api/studios", async (req, res) => {
  const b = req.body;

  const studio = {
    title: String(b.title ?? "").trim(),
    category: String(b.category ?? "").trim(),
    hourlyRate: Number(b.hourlyRate),
    securityDeposit: Number(b.securityDeposit ?? 0),
    maxCapacity: Number(b.maxCapacity),
    location: String(b.location ?? "").trim(),
    image: String(b.image ?? "").trim(),
    amenities: Array.isArray(b.amenities) ? b.amenities.map(String) : [],
    overview: String(b.overview ?? "").trim(),
    ownerName: String(b.ownerName ?? "").trim(),
    ownerEmail: String(b.ownerEmail ?? "").trim(),
  };

  const invalid =
    !studio.title ||
    !studio.category ||
    !studio.location ||
    !studio.image ||
    !studio.overview ||
    !studio.ownerName ||
    !studio.ownerEmail ||
    !(studio.hourlyRate > 0) ||
    !(studio.maxCapacity > 0) ||
    !(studio.securityDeposit >= 0);

  if (invalid) {
    return res
      .status(400)
      .json({ message: "Please fill in all required fields correctly" });
  }

  const doc = {
    ...studio,
    rating: 0,
    reviewCount: 0,
    createdAt: new Date(),
  };

  const result = await studioCollection.insertOne(doc);
  res.status(201).json({ ...doc, _id: result.insertedId });
});

app.get("/api/studios", async (req, res) => {
  const { category, search, location, limit, sort, ownerEmail } = req.query;

  const filter = {};
  if (category) filter.category = String(category);
  if (search) filter.title = { $regex: String(search), $options: "i" };
  if (location) filter.location = { $regex: String(location), $options: "i" };
  if (ownerEmail) filter.ownerEmail = String(ownerEmail);

  const sorts = {
    rating: { rating: -1 },
    "price-asc": { hourlyRate: 1 },
    "price-desc": { hourlyRate: -1 },
    newest: { createdAt: -1 },
  };
  const sortBy = sorts[String(sort)] ?? sorts.newest;
  const max = Math.min(Number(limit) || 50, 100);

  const studios = await studioCollection
    .find(filter)
    .sort(sortBy)
    .limit(max)
    .toArray();
  res.json(studios);
});

// Single studio (for details and edit pages)
app.get("/api/studios/:id", async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid studio id" });
  }
  const studio = await studioCollection.findOne({
    _id: new ObjectId(req.params.id),
  });
  if (!studio) return res.status(404).json({ message: "Studio not found" });
  res.json(studio);
});

// Update studio
app.put("/api/studios/:id", async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid studio id" });
  }

  const b = req.body;
  const fields = {
    title: String(b.title ?? "").trim(),
    category: String(b.category ?? "").trim(),
    hourlyRate: Number(b.hourlyRate),
    securityDeposit: Number(b.securityDeposit ?? 0),
    maxCapacity: Number(b.maxCapacity),
    location: String(b.location ?? "").trim(),
    image: String(b.image ?? "").trim(),
    amenities: Array.isArray(b.amenities) ? b.amenities.map(String) : [],
    overview: String(b.overview ?? "").trim(),
  };

  const invalid =
    !fields.title ||
    !fields.category ||
    !fields.location ||
    !fields.image ||
    !fields.overview ||
    !(fields.hourlyRate > 0) ||
    !(fields.maxCapacity > 0) ||
    !(fields.securityDeposit >= 0);

  if (invalid) {
    return res
      .status(400)
      .json({ message: "Please fill in all required fields correctly" });
  }

  const result = await studioCollection.updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { ...fields, updatedAt: new Date() } }
  );
  if (result.matchedCount === 0) {
    return res.status(404).json({ message: "Studio not found" });
  }
  res.json({ updated: true });
});

// Delete studio
app.delete("/api/studios/:id", async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid studio id" });
  }
  const result = await studioCollection.deleteOne({
    _id: new ObjectId(req.params.id),
  });
  if (result.deletedCount === 0) {
    return res.status(404).json({ message: "Studio not found" });
  }
  res.json({ deleted: true });
});



app.listen(PORT, () => {
  console.log(`Example app listening on port ${PORT}`);
});