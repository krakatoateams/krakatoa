import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          // access_type=offline ensures Google returns a refresh_token
          // prompt=consent forces the consent screen every time so the
          // refresh_token is always included (not just on first login)
          access_type: "offline",
          prompt: "consent",
          scope: [
            "openid",
            "email",
            "profile",
            "https://www.googleapis.com/auth/youtube.upload",
          ].join(" "),
        },
      },
    }),
  ],

  secret: process.env.NEXTAUTH_SECRET,

  debug: true,
  logger: {
    error(code, metadata) { console.error("NEXTAUTH ERROR:", code, metadata); },
    warn(code)            { console.warn("NEXTAUTH WARN:", code); },
    debug(code, metadata) { console.log("NEXTAUTH DEBUG:", code, metadata); },
  },
};
