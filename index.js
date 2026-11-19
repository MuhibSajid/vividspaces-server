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
const bookingCollection = db.collection('bookings');


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



///      Booking Api          //

// My bookings (as guest): ?email=
app.get("/api/bookings", async (req, res) => {
  const email = String(req.query.email ?? "");
  if (!email) return res.status(400).json({ message: "Email is required" });

  const bookings = await bookingCollection
    .find({ userEmail: email })
    .sort({ createdAt: -1 })
    .toArray();
  res.json(bookings);
});


// Create booking (status: Pending)
app.post("/api/bookings", async (req, res) => {
  const { studioId, date, startTime, endTime, crewSize, userEmail, userName } =
    req.body;

  const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  if (!ObjectId.isValid(studioId)) {
    return res.status(400).json({ message: "Invalid studio id" });
  }
  if (!userEmail || !userName) {
    return res.status(400).json({ message: "Guest details are missing" });
  }
  if (!DATE_RE.test(date) || !TIME_RE.test(startTime) || !TIME_RE.test(endTime)) {
    return res.status(400).json({ message: "Please choose a valid date and time" });
  }
  if (endTime <= startTime) {
    return res.status(400).json({ message: "End time must be after start time" });
  }
  if (date < new Date().toISOString().slice(0, 10)) {
    return res.status(400).json({ message: "Booking date can't be in the past" });
  }

  const studio = await studioCollection.findOne({ _id: new ObjectId(studioId) });
  if (!studio) return res.status(404).json({ message: "Studio not found" });

  if (studio.ownerEmail === userEmail) {
    return res.status(400).json({ message: "You can't book your own studio" });
  }

  // Reject overlap with a Confirmed booking
  const conflict = await bookingCollection.findOne({
    studioId,
    date,
    status: "Confirmed",
    startTime: { $lt: endTime },
    endTime: { $gt: startTime },
  });
  if (conflict) {
    return res.status(409).json({
      message: `This slot overlaps a confirmed booking (${conflict.startTime}–${conflict.endTime}). Please pick another time.`,
    });
  }

  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  const hours = (eh * 60 + em - (sh * 60 + sm)) / 60;

  const doc = {
    studioId,
    studioTitle: studio.title,
    studioImage: studio.image,
    studioLocation: studio.location,
    ownerEmail: studio.ownerEmail,
    userEmail,
    userName,
    date,
    startTime,
    endTime,
    hours,
    crewSize: String(crewSize ?? ""),
    hourlyRate: studio.hourlyRate,
    totalPrice: Math.round(hours * studio.hourlyRate * 100) / 100,
    status: "Pending",
    createdAt: new Date(),
  };

  const result = await bookingCollection.insertOne(doc);
  res.status(201).json({ ...doc, _id: result.insertedId });
});


// Guest cancels a Pending booking
app.patch("/api/bookings/:id/cancel", async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid booking id" });
  }

  const result = await bookingCollection.updateOne(
    { _id: new ObjectId(req.params.id), status: "Pending" },
    { $set: { status: "Cancelled", cancelledAt: new Date() } }
  );
  if (result.matchedCount === 0) {
    return res
      .status(400)
      .json({ message: "Only pending bookings can be cancelled" });
  }
  res.json({ cancelled: true });
});







app.listen(PORT, () => {
  console.log(`Example app listening on port ${PORT}`);
});