const { z, email, password } = require('./common');

const login = {
  body: z.object({
    collegeCode: z.string().trim().min(2).max(20),
    email,
    password: z.string().min(1).max(128)
  })
};

const changePassword = {
  body: z.object({
    currentPassword: z.string().min(1).max(128),
    newPassword: password
  })
};

const collegeLookup = {
  query: z.object({ code: z.string().trim().min(2).max(20) })
};

const forgotPassword = { body: z.object({ collegeCode: z.string().trim().min(2).max(20), email }) };
const resetPassword = { body: z.object({ token: z.string().min(20).max(200), newPassword: password }) };

module.exports = { login, changePassword, collegeLookup, forgotPassword, resetPassword };
