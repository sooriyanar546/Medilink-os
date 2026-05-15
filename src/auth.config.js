export const authConfig = {
  pages: {
    signIn: '/login',
  },
  providers: [], // Configured in auth.js to avoid Prisma/bcrypt on the Edge
  callbacks: {
    // Persist role into the JWT token
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.department = user.department;
        token.id = user.id;
        token.patientId = user.patientId;
        token.doctorId = user.doctorId;
      }
      return token;
    },
    // Expose role to the client session
    async session({ session, token }) {
      if (session.user) {
        session.user.role = token.role;
        session.user.department = token.department;
        session.user.id = token.id;
        session.user.patientId = token.patientId;
        session.user.doctorId = token.doctorId;
      }
      return session;
    },
  },
  session: {
    strategy: 'jwt',
    maxAge: 8 * 60 * 60, // 8-hour hospital shift
  },
};
