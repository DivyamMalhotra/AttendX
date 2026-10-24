const { z, objectId, pagination } = require('./common');

const profileUpdate = {
  body: z.object({ phone: z.string().trim().regex(/^[0-9+()\- ]{0,20}$/, 'Enter a valid phone number') })
};

const notificationList = {
  query: z.object({ unread: z.enum(['true', 'false']).optional(), ...pagination })
};

const notificationParam = { params: z.object({ id: objectId }) };

module.exports = { profileUpdate, notificationList, notificationParam };
