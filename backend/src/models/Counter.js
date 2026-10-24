const mongoose = require('mongoose');

/** Atomic sequence generator (receipt numbers, etc.). */
const counterSchema = new mongoose.Schema({
  _id: { type: String },
  seq: { type: Number, default: 0 }
});

counterSchema.statics.next = async function (key) {
  const doc = await this.findOneAndUpdate(
    { _id: key }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' }
  );
  return doc.seq;
};

module.exports = mongoose.model('Counter', counterSchema);
