import express from "express";
import cors from "cors";
import "dotenv/config";
import cookieParser from "cookie-parser";
import { jwtVerify } from "jose";
import { MongoClient, ObjectId } from "mongodb";

const app = express();
const PORT = process.env.PORT || 5000;

app.use(
  cors({
    origin: ["http://localhost:3000", "https://vividspaces-client.vercel.app"],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

/* ================= DATABASE ================= */

const client = new MongoClient(process.env.MONGODB_SERVER_URL);

try {
  await client.connect();
  console.log("You successfully connected to MongoDB!");
} catch (err) {
  console.error("MongoDB connection failed:", err);
  throw err;
}

const db = client.db("vividspaces");
const studioCollection = db.collection("studios");
const bookingCollection = db.collection("bookings");

/* ================= AUTH (JWT) ================= */

if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET is not set");
}
const JWT_KEY = new TextEncoder().encode(process.env.JWT_SECRET);

// Reads the JWT from the HttpOnly cookie, rejects with 401 if missing or invalid
async function verifyToken(req, res, next) {
  const token = req.cookies?.vs_token;
  if (!token) return res.status(401).json({ message: "Unauthorized" });

  try {
    const { payload } = await jwtVerify(token, JWT_KEY, {
      algorithms: ["HS256"],
    });
    req.user = { id: payload.sub, email: payload.email, name: payload.name };
    next();
  } catch {
    res.status(401).json({ message: "Invalid or expired token" });
  }
}

/* ================= ROOT ================= */

app.get("/", (req, res) => {
  res.json({ ok: true, name: "VividSpaces API" });
});

/* ================= STUDIOS ================= */

// Add new studio (owner comes from the token)
app.post("/api/studios", verifyToken, async (req, res) => {
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
    ownerName: String(req.user.name ?? "").trim(),
    ownerEmail: String(req.user.email ?? "").trim(),
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

// List studios: ?category=&search=&location=&limit=&sort=&ownerEmail=
app.get("/api/studios", async (req, res) => {
  const { category, search, location, limit, sort, ownerEmail } = req.query;

  const filter = {};
  if (category) filter.category = String(category);
  if (search) filter.title = { $regex: String(search), $options: "i" };
  if (location) filter.location = { $regex: String(location), $options: "i" };
  if (ownerEmail) filter.ownerEmail = String(ownerEmail);

  const sorts = {
    rating: { rating: -1, createdAt: -1 },
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

// Studio count per category (for the home page)
app.get("/api/categories/counts", async (req, res) => {
  const rows = await studioCollection
    .aggregate([{ $group: { _id: "$category", count: { $sum: 1 } } }])
    .toArray();
  res.json(Object.fromEntries(rows.map((r) => [r._id, r.count])));
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

// Update studio (owner only)
app.put("/api/studios/:id", verifyToken, async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid studio id" });
  }

  const existing = await studioCollection.findOne({
    _id: new ObjectId(req.params.id),
  });
  if (!existing) return res.status(404).json({ message: "Studio not found" });
  if (existing.ownerEmail !== req.user.email) {
    return res
      .status(403)
      .json({ message: "You can only edit your own studios" });
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
    { _id: existing._id },
    { $set: { ...fields, updatedAt: new Date() } }
  );
  if (result.matchedCount === 0) {
    return res.status(404).json({ message: "Studio not found" });
  }
  res.json({ updated: true });
});

// Delete studio (owner only)
app.delete("/api/studios/:id", verifyToken, async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid studio id" });
  }

  const existing = await studioCollection.findOne({
    _id: new ObjectId(req.params.id),
  });
  if (!existing) return res.status(404).json({ message: "Studio not found" });
  if (existing.ownerEmail !== req.user.email) {
    return res
      .status(403)
      .json({ message: "You can only delete your own studios" });
  }

  await studioCollection.deleteOne({ _id: existing._id });
  res.json({ deleted: true });
});

/* ================= BOOKINGS ================= */

// My bookings (as guest)
app.get("/api/bookings", verifyToken, async (req, res) => {
  const bookings = await bookingCollection
    .find({ userEmail: req.user.email })
    .sort({ createdAt: -1 })
    .toArray();
  res.json(bookings);
});

// Bookings for studios I host
app.get("/api/bookings/host", verifyToken, async (req, res) => {
  const bookings = await bookingCollection
    .find({ ownerEmail: req.user.email })
    .sort({ createdAt: -1 })
    .toArray();
  res.json(bookings);
});

// Create booking (status: Pending). Guest details come from the token.
app.post("/api/bookings", verifyToken, async (req, res) => {
  const { studioId, date, startTime, endTime, crewSize } = req.body;
  const userEmail = req.user.email;
  const userName = req.user.name;

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

// Guest cancels their own Pending booking
app.patch("/api/bookings/:id/cancel", verifyToken, async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid booking id" });
  }

  const result = await bookingCollection.updateOne(
    {
      _id: new ObjectId(req.params.id),
      userEmail: req.user.email,
      status: "Pending",
    },
    { $set: { status: "Cancelled", cancelledAt: new Date() } }
  );
  if (result.matchedCount === 0) {
    return res
      .status(400)
      .json({ message: "Only your own pending bookings can be cancelled" });
  }
  res.json({ cancelled: true });
});

// Host updates a booking: Confirmed / Completed / Cancelled (studio owner only)
app.patch("/api/bookings/:id/status", verifyToken, async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid booking id" });
  }

  const { status } = req.body;
  const allowedNext = {
    Pending: ["Confirmed", "Cancelled"],
    Confirmed: ["Completed", "Cancelled"],
  };

  const booking = await bookingCollection.findOne({
    _id: new ObjectId(req.params.id),
  });
  if (!booking) return res.status(404).json({ message: "Booking not found" });

  if (booking.ownerEmail !== req.user.email) {
    return res.status(403).json({
      message: "You can only manage bookings for your own studios",
    });
  }

  if (!allowedNext[booking.status]?.includes(status)) {
    return res.status(400).json({
      message: `A ${booking.status.toLowerCase()} booking can't be changed to ${String(status).toLowerCase()}.`,
    });
  }

  // Re-check overlap before confirming
  if (status === "Confirmed") {
    const conflict = await bookingCollection.findOne({
      _id: { $ne: booking._id },
      studioId: booking.studioId,
      date: booking.date,
      status: "Confirmed",
      startTime: { $lt: booking.endTime },
      endTime: { $gt: booking.startTime },
    });
    if (conflict) {
      return res.status(409).json({
        message: `This slot overlaps a confirmed booking (${conflict.startTime}–${conflict.endTime}).`,
      });
    }
  }

  await bookingCollection.updateOne(
    { _id: booking._id },
    { $set: { status, updatedAt: new Date() } }
  );
  res.json({ updated: true, status });
});

/* ================= FALLBACKS ================= */

app.use((req, res) => res.status(404).json({ message: "Route not found" }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: "Internal server error" });
});

/* ================= START ================= */

// Vercel runs the exported app itself, so only listen locally
if (process.env.VERCEL !== "1") {
  app.listen(PORT, () => {
    console.log(`API running on port ${PORT}`);
  });
}

export default app;