const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 5000;
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const nodemailer = require("nodemailer");
const mg = require("nodemailer-mailgun-transport");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

//MongoDB Setup
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.90qadcl.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

// Send email to patient about booking confirmation
function sendBookingEmail(booking) {
  const { email, treatment, appointmentDate, slot } = booking;

  // SendGrid transporter setup
  // let transporter = nodemailer.createTransport({
  //   host: "smtp.sendgrid.net",
  //   port: 587,
  //   auth: {
  //     user: "apikey",
  //     pass: process.env.SENDGRID_API_KEY,
  //   },
  // });

  console.log(booking);

  // MailGun transporter setup
  const auth = {
    auth: {
      api_key: process.env.MAILGUN_API_KEY,
      domain: process.env.EMAIL_SEND_DOMAIN,
    },
  };

  const transporter = nodemailer.createTransport(mg(auth));

  transporter.sendMail(
    {
      from: "sajidsorker86@gmail.com", // verified sender email
      to: email, // recipient email
      subject: `Appointment confirmed`, // Subject line
      text: "Hello world!", // plain text body
      html: `
      <h3>Your appointment is confirmed</h3>
      <div>
        <p>Your appoint for treatment ${treatment} is confirmed.</p>
        <p>Please visit us on ${appointmentDate} at ${slot}</p>
        <p>Thank from Doctors Portal.</p>
      </div>
      `, // html body
    },
    function (error, info) {
      if (error) {
        console.log(error);
      } else {
        console.log("Email sent: " + info);
      }
    }
  );
}

// Verify the JW token
const verifyJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send("Unauthorized access");
  }

  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decode) {
    if (err) {
      return res.status(403).send({ message: "Forbidden access" });
    }
    req.decoded = decode;
    next();
  });
};

async function run() {
  try {
    const AppointmentOptionsCollection = client
      .db("DoctorsPortal")
      .collection("AppointmentOptions");
    const BookingCollection = client.db("DoctorsPortal").collection("bookings");
    const UserCollection = client.db("DoctorsPortal").collection("users");
    const DoctorsCollection = client.db("DoctorsPortal").collection("doctors");
    const PaymentsCollection = client
      .db("DoctorsPortal")
      .collection("payments");

    // Note: Make sure you use verify admin after verify JWT
    const verifyAdmin = async (req, res, next) => {
      const decodeEmail = req.decoded.email;
      const query = { email: decodeEmail };
      const user = await UserCollection.findOne(query);
      if (user.role !== "admin") {
        return res.status(403).send({ message: "Forbidden Access" });
      }

      next();
    };

    // Use Aggregate to query multiple collection and then data
    app.get("/appointmentOptions", async (req, res) => {
      const date = req.query.date;

      const query = {};
      const options = await AppointmentOptionsCollection.find(query).toArray(); // load all treatment options

      const bookingQuery = { appointmentDate: date };
      const bookedByDate = await BookingCollection.find(bookingQuery).toArray(); // load booking options by specific date

      // code carefully
      options.forEach((option) => {
        const optionBooked = bookedByDate.filter(
          (book) => book.treatment === option.name
        ); // search bookedByDate option by name
        const bookedSlots = optionBooked.map((book) => book.slot);

        const remainingSlots = option.slots.filter(
          (slot) => !bookedSlots.includes(slot)
        );
        option.slots = remainingSlots;
      });
      res.send(options);
    });

    // get just all appointment options name // (find specific field from many field) // jei jei field gula dorkar tader namer por '1' user korle shudu tader dibe r '0' user korle tader dibe na.

    app.get("/appointmentSpecialty", async (req, res) => {
      const query = {};
      const result = await AppointmentOptionsCollection.find(query)
        .project({ name: 1 })
        .toArray();

      res.send(result);
    });

    //Aggregation pipeline

    // app.get('/v2/appointmentOptions', async(req, res) =>{
    //     const date = req.query.date;
    //     const options = await AppointmentOptionsCollection.aggregate([
    //         {
    //             $lookup:{
    //                 from: 'bookings',
    //                 localField: 'name',
    //                 foreignField: 'treatment',
    //                 pipeline: [
    //                     {
    //                         $match:{
    //                             $expr: {
    //                                 $eq:['$appointmentDate', date]
    //                             }
    //                         }
    //                     }
    //                  ],
    //                 as: 'booked'
    //             }
    //         },
    //         {
    //             $project:{
    //                 name:1,
    //                 slots:1,
    //                 booked:{
    //                     $map:{
    //                         input:'$booked',
    //                         as:'book',
    //                         in:'$book.slot'
    //                     }
    //                 }
    //             }
    //         },
    //         {
    //             $project:{
    //                 name:1,
    //                 slots:{
    //                     $setDifference:['$slots','$booked']
    //                 }
    //             }
    //         }
    //     ]).toArray();
    //     res.send(options);
    // })

    /* 
        * API Naming Convention
        1. app.get('/bookings')
        2. app.get('/bookings/:id')
        3. app.patch('/bookings/:id')
        4. app.delete('/bookings/:id')
        */

    // Get all bookings
    app.get("/bookings", verifyJWT, async (req, res) => {
      const email = req.query.email;
      const decodedEmail = req.decoded.email;
      if (email !== decodedEmail) {
        return res.status(403).send({ message: "Forbidden Access" });
      }
      const query = { email: email };
      const bookings = await BookingCollection.find(query).toArray();

      res.send(bookings);
    });

    //Get specific booking
    app.get("/bookings/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const booking = await BookingCollection.findOne(query);

      res.send(booking);
    });

    // Book an appointment
    app.post("/bookings", async (req, res) => {
      const booking = req.body;

      const query = {
        appointmentDate: booking.appointmentDate,
        treatment: booking.treatment,
        email: booking.email,
      };
      const alreadyBooked = await BookingCollection.find(query).toArray();

      if (alreadyBooked.length) {
        const message = `You already have a booking on ${booking.appointmentDate} `;
        return res.send({ acknowledged: false, message });
      }

      const result = await BookingCollection.insertOne(booking);

      // Send email to patient about booking confirmation
      sendBookingEmail(booking);

      res.send(result);
    });

    // cancel an appointment
    app.put("/bookings/cancel/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;

      const result = await BookingCollection.deleteOne({
        _id: new ObjectId(id),
      });

      res.send(result);
    });

    // get all users
    app.get("/users", verifyJWT, verifyAdmin, async (req, res) => {
      const users = await UserCollection.find({}).toArray();

      res.send(users);
    });

    // Verify user Admin or not?
    app.get("/users/admin/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const user = await UserCollection.findOne(query);

      res.send({ isAdmin: user?.role === "admin" });
    });

    // Save single user to db
    app.post("/users", async (req, res) => {
      const user = req.body;
      const result = await UserCollection.insertOne(user);

      res.send(result);
    });

    // Make an Admin
    app.put("/users/admin/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const options = { upsert: true };
      const updatedDoc = {
        $set: {
          role: "admin",
        },
      };

      const result = await UserCollection.updateOne(
        filter,
        updatedDoc,
        options
      );
      res.send(result);
    });
    // Delete user
    app.delete(
      "/users/delete/:id",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };

        const result = await UserCollection.deleteOne(filter);
        res.send(result);
      }
    );

    //  Stripe payment system integration;
    app.post("/create-payment-intent", async (req, res) => {
      const booking = req.body;

      const price = booking.price;
      const amount = price * 100;

      const paymentIntent = await stripe.paymentIntents.create({
        currency: "usd",
        amount: amount,
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    // Store payment data to db
    app.post("/payments", async (req, res) => {
      const payment = req.body;
      const id = payment.bookingId;
      const filter = { _id: new ObjectId(id) };
      const options = { upsert: true };
      const updatedDoc = {
        $set: {
          paid: true,
          transactionId: payment.TnxId,
        },
      };
      const updateResult = await BookingCollection.updateOne(
        filter,
        updatedDoc,
        options
      );

      const result = await PaymentsCollection.insertOne(payment);

      res.send(result);
    });

    // Issue JWT
    app.get("/jwt", async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const user = await UserCollection.findOne(query);

      if (user) {
        const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, {
          expiresIn: "1h",
        });

        return res.send({ accessToken: token });
      }

      res.status(403).send({ accessToken: "" });
    });

    // Add a doctor
    app.post("/doctors", verifyJWT, verifyAdmin, async (req, res) => {
      const doctor = req.body;
      const result = await DoctorsCollection.insertOne(doctor);

      res.send(result);
    });

    // Get all doctors
    app.get("/doctors", verifyJWT, verifyAdmin, async (req, res) => {
      const query = {};
      const doctors = await DoctorsCollection.find(query).toArray();

      res.send(doctors);
    });

    // Delete doctors
    app.delete("/doctors/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const result = await DoctorsCollection.deleteOne(filter);

      res.send(result);
    });
  } finally {
  }
}
// Calling the run function
run().catch((err) => console.error(err));

// Default route
app.get("/", (req, res) => {
  res.send("Doctors Portal server is running");
});

// LISTEN
app.listen(port, () => {
  console.log(`Doctors portal running on port: ${port}`);
});
