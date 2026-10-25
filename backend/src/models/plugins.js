const DELETE_OPS = ['deleteOne', 'deleteMany', 'findOneAndDelete', 'findOneAndReplace', 'replaceOne'];

/**
 * Financial and audit records are append-only: they can be updated through the
 * service layer but can never be deleted or replaced, so history cannot be hidden.
 */
function preventDeletion(schema, label = 'This record') {
  const block = function () {
    throw new Error(`${label} cannot be deleted or replaced.`);
  };
  DELETE_OPS.forEach(op => schema.pre(op, { query: true, document: false }, block));
  schema.pre('deleteOne', { query: false, document: true }, block);
}

/** Audit rows may never be modified after they are written. */
function preventUpdates(schema, label = 'This record') {
  const block = function () {
    throw new Error(`${label} is immutable.`);
  };
  ['updateOne', 'updateMany', 'findOneAndUpdate'].forEach(op => schema.pre(op, block));
}

module.exports = { preventDeletion, preventUpdates };
