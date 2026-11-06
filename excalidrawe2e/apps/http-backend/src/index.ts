import express from "express";
import jwt from "jsonwebtoken";
import {isLoggedIn} from "./middleware"
import {JWT_SECRET} from '@repo/backend-common/config'
import {CreateUserSchema,SigninUserSchema,CreateRoomSchema,ClaimAccountSchema,PresignUploadSchema,ConfirmUploadSchema,MAX_IMAGE_BYTES} from "@repo/common/types";
import { guestUsername, MAX_NAME_ATTEMPTS } from "./guestNames";
import { startGuestSweeper, GUEST_TTL_DAYS, deleteAccount } from "./guestCleanup";
import { presignPut, headObject, publicUrl, getObjectPrefix } from "./storage";
import { readDimensions, HEADER_BYTES } from "./imageSize";
import { prismaClient} from "@repo/db-package/client"
import cors from "cors"
import bcrypt from "bcrypt"
const app = express()
app.use(express.json())
app.use(cors())

/**
 * How long a session lasts.
 *
 * Long enough that someone returning to a board next week is simply still
 * signed in, which matters most for guests: the token is the only thing
 * holding a one-click account, so an expiry is also the account's lifetime.
 *
 * Absolute rather than sliding - 15 days from issue, not from last use. A
 * sliding window needs a refresh endpoint and a way to revoke, which is a
 * bigger change than this is worth today.
 */
const TOKEN_TTL = `${GUEST_TTL_DAYS}d`;

/** The only place a session token is minted, so the lifetime cannot drift. */
function issueToken(user: { id: string; username: string }) {
  return jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, {
    expiresIn: TOKEN_TTL,
  });
}

//done 
app.post("/signup", async (req,res) => {
    const email = req.body.email
    const password = req.body.password
    const username = req.body.username
    const data = CreateUserSchema.safeParse(req.body)
    if(!data.success) {
        return res.json({
            message : "Incorrect Inputs"
        })
    } else {
        try {
        const hashedPassword = await bcrypt.hash(password, 10)
        await prismaClient.user.create({
            data: {
                username: username,
                email :  email,
                password : hashedPassword,
                photo : ""
            },
        })
        res.status(200).send({message:"User created"})
    } catch (err){
        res.status(400).send({message: err})
    }
    }
}) 
// done 
app.post("/signin", async (req,res) => {
    const safeData = SigninUserSchema.safeParse(req.body)
    if (!safeData.success) {
        return res.status(422).send({ message: "Invalid input format" })
    }
    const { password } = safeData.data
    // one field for both: guests have no email, and everyone who signed up
    // before this change typed one. Looking in both columns means the switch
    // to username-first logins locks nobody out.
    const identifier = (safeData.data.identifier ?? safeData.data.email)!.trim()

    const user = await prismaClient.user.findFirst({
        where: { OR: [{ username: identifier }, { email: identifier }] },
        select: { username: true, id: true, password: true, isGuest: true },
    })

    // Same answer for "no such user" and "wrong password": telling them apart
    // turns this endpoint into a way to discover which usernames exist.
    const DENIED = { message: "Invalid credentials" }
    if (!user) {
        return res.status(401).send(DENIED)
    }
    if (!user.password) {
        // a guest, held by its token alone - there is no password to check,
        // and bcrypt.compare against an empty hash would throw
        return res.status(401).send({
            message: "That is a guest account. Open it again from the browser you created it in.",
        })
    }

    const passwordMatch = await bcrypt.compare(password, user.password)
    if (!passwordMatch) {
        return res.status(401).send(DENIED)
    }
    return res.status(200).send({ token: issueToken(user) })
})

/**
 * Start a one-click guest session.
 *
 * No form, no email, no password: the account is held entirely by the token
 * this returns, which is also why its expiry is the account's lifetime. The
 * claim route below is how it stops being disposable.
 */
app.post("/guest", async (req, res) => {
    // The database decides uniqueness, not a pre-flight check: a check
    // followed by an insert is a race, and the unique constraint is the only
    // thing that can actually settle it. So: try, and retry on collision.
    for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt++) {
        try {
            const user = await prismaClient.user.create({
                data: {
                    username: guestUsername(attempt),
                    email: null,
                    password: null,
                    isGuest: true,
                    photo: "",
                },
                select: { id: true, username: true },
            })
            return res.status(200).send({
                token: issueToken(user),
                username: user.username,
                isGuest: true,
            })
        } catch (err: any) {
            if (err?.code === "P2002") continue   // name taken; the suffix widens
            console.error("[auth] guest creation failed:", err)
            return res.status(500).send({ message: "Could not start a guest session" })
        }
    }
    console.error("[auth] exhausted guest name attempts")
    return res.status(503).send({ message: "Could not start a guest session, try again" })
})

/**
 * Who the caller is.
 *
 * The token carries a username, but not whether the account is a guest - and
 * baking that into the token would mean it going stale the moment the account
 * is claimed. Asked rather than stored, so it is always current.
 */
app.get("/me", isLoggedIn, async (req, res) => {
    //@ts-ignore - set by isLoggedIn
    const userId: string = req.userId
    const user = await prismaClient.user.findUnique({
        where: { id: userId },
        select: { id: true, username: true, email: true, isGuest: true },
    })
    if (!user) {
        // 401, not 404: the token verified, but the account it names is gone
        // - deleted, or swept after its guest session expired. The credential
        // no longer identifies anyone, which is an authentication failure, and
        // saying so is what lets the client sign out instead of sitting on a
        // token that quietly fails every request.
        return res.status(401).send({ message: "This account no longer exists" })
    }
    return res.send(user)
})

/**
 * Delete the signed-in account, permanently.
 *
 * Same erasure as the expiry sweep, down to the same function: the account,
 * its memberships and the rooms it created all go, while anything it drew on
 * other people's boards stays and stays editable.
 *
 * A password is required when the account has one. The token alone is not
 * enough for something irreversible - a borrowed laptop or a stolen token
 * should not be able to destroy an account and every board on it. Guests have
 * no password to ask for, so for them the confirmation is the UI's job.
 */
app.delete("/account", isLoggedIn, async (req, res) => {
    //@ts-ignore - set by isLoggedIn
    const userId: string = req.userId

    const user = await prismaClient.user.findUnique({
        where: { id: userId },
        select: { password: true, isGuest: true },
    })
    if (!user) {
        // 401, not 404: the token verified, but the account it names is gone
        // - deleted, or swept after its guest session expired. The credential
        // no longer identifies anyone, which is an authentication failure, and
        // saying so is what lets the client sign out instead of sitting on a
        // token that quietly fails every request.
        return res.status(401).send({ message: "This account no longer exists" })
    }

    if (user.password) {
        const password = req.body?.password
        if (typeof password !== "string" || password.length === 0) {
            return res.status(422).send({ message: "Enter your password to delete this account" })
        }
        const matches = await bcrypt.compare(password, user.password)
        if (!matches) {
            // 403 rather than 401: the token is fine, the confirmation is not,
            // and a 401 would make the client think the session had expired
            return res.status(403).send({ message: "That password is not correct" })
        }
    }

    try {
        const { rooms } = await deleteAccount(userId)
        return res.send({ deleted: true, roomsDeleted: rooms })
    } catch (err) {
        console.error("[auth] account deletion failed:", err)
        return res.status(500).send({ message: "Could not delete the account" })
    }
})

/**
 * Turn the signed-in guest into a real account.
 *
 * Keeps the same user row, so every board, membership and shape it owns stays
 * put - that is the whole point of having an account before you have
 * credentials. Only the credentials are added.
 */
app.post("/account/claim", isLoggedIn, async (req, res) => {
    const parsed = ClaimAccountSchema.safeParse(req.body)
    if (!parsed.success) {
        return res.status(422).send({
            message: parsed.error.issues[0]?.message ?? "Invalid details",
        })
    }
    //@ts-ignore - set by isLoggedIn
    const userId: string = req.userId

    const current = await prismaClient.user.findUnique({
        where: { id: userId },
        select: { isGuest: true },
    })
    if (!current) {
        // 401, not 404: the token verified, but the account it names is gone
        // - deleted, or swept after its guest session expired. The credential
        // no longer identifies anyone, which is an authentication failure, and
        // saying so is what lets the client sign out instead of sitting on a
        // token that quietly fails every request.
        return res.status(401).send({ message: "This account no longer exists" })
    }
    if (!current.isGuest) {
        // not an error the UI should ever cause, but claiming twice would
        // otherwise overwrite a real account's password from a stale tab
        return res.status(409).send({ message: "This account is already registered" })
    }

    try {
        const user = await prismaClient.user.update({
            where: { id: userId },
            data: {
                email: parsed.data.email,
                password: await bcrypt.hash(parsed.data.password, 10),
                isGuest: false,
            },
            select: { id: true, username: true },
        })
        // a fresh token: the old one says nothing untrue, but reissuing keeps
        // the 15 days measured from becoming a real account
        return res.status(200).send({ token: issueToken(user), username: user.username })
    } catch (err: any) {
        if (err?.code === "P2002") {
            return res.status(409).send({ message: "That email is already registered" })
        }
        console.error("[auth] claim failed:", err)
        return res.status(500).send({ message: "Could not save those details" })
    }
})
app.post("/room", isLoggedIn ,async (req,res) => {
    const parsedData = CreateRoomSchema.safeParse(req.body);
    if(!parsedData.success){
        return res.json({
            message:"Incorrect Inputs"
        })
    }
    const slug = req.body.slug
    //@ts-ignore
    const userId = req.userId;
    try{
    const room = await prismaClient.room.create({
        data: {
            slug:slug,
            adminId:userId
        }
    })
    res.send({
        roomId : room.id, slug :room.slug
    })
} catch (err){
    return res.json({message:"room already exist"})
}
    
})
//fetch room details using slugs
app.get("/room/:slug", isLoggedIn, async(req , res) => {
    const room = await prismaClient.room.findUnique({
        where : { slug : req.params.slug}, 
        select : {id:true, slug: true, createdAt: true, admin:{select : {id: true , username :true}}}
})
    if(!room ) {
        return res.status(404).send({err : "Error finding room"})
    } else {
        return res.send({room})
    }
})
app.get("/shapes/:roomId" , isLoggedIn, async (req, res) => {
    const roomId = Number(req.params.roomId)
    if(Number.isNaN(roomId)) {
        return res.status(404).send({message : "Invalid Room Id"})
    } else {
        try {
            const shapes = await prismaClient.shape.findMany({
                where : {roomId}, 
                orderBy: {createdAt : "asc"}
            })
            res.send({shapes})
        } catch(err) {
            return res.status(411).send({err : "Error Fetching content"})
        }
    }
})
/**
 * Join a room by its slug - what happens when someone opens a shared link.
 *
 * Idempotent: joining twice is the same as joining once, and the admin is
 * never recorded as a member, since ownership already lists the room for them.
 */
app.post("/room/:slug/join", isLoggedIn, async (req, res) => {
    //@ts-ignore
    const userId = req.userId;
    try {
        const room = await prismaClient.room.findUnique({
            where: { slug: req.params.slug },
            select: { id: true, slug: true, adminId: true },
        });
        if (!room) {
            return res.status(404).send({ message: "Room not found" });
        }
        if (room.adminId === userId) {
            return res.send({ room, joined: false, reason: "you own this room" });
        }
        await prismaClient.roomMember.upsert({
            where: { roomId_userId: { roomId: room.id, userId } },
            create: { roomId: room.id, userId },
            update: {},
        });
        return res.send({ room, joined: true });
    } catch (err) {
        console.error("[http] join failed:", err);
        return res.status(500).send({ message: "Could not join that room" });
    }
});

/**
 * Every room this person can get back to: the ones they created, plus the ones
 * they have opened through a shared link. `owned` tells the two apart so the
 * dashboard can group them and only offer rename or delete on its own.
 */
app.get("/rooms", isLoggedIn, async(req, res) => {
    //@ts-ignore
const userId = req.userId
try {
const owned = await prismaClient.room.findMany({
    where : {adminId : userId},
    orderBy: {createdAt: "desc"},
    select : {id:true, slug: true, createdAt:true}
})
const memberships = await prismaClient.roomMember.findMany({
    where: { userId },
    orderBy: { joinedAt: "desc" },
    select: {
        joinedAt: true,
        room: { select: { id: true, slug: true, createdAt: true, admin: { select: { username: true } } } },
    },
})
const joined = memberships.map((m) => ({
    ...m.room,
    joinedAt: m.joinedAt,
    owner: m.room.admin.username,
}))
res.send({
    rooms: owned.map((r) => ({ ...r, owned: true })),
    joined: joined.map(({ admin, ...r }: any) => ({ ...r, owned: false })),
})
}
catch(err) {
    res.status(404).send({err : "Error finding user docs"})
}
})
app.delete("/room/:id" , isLoggedIn, async(req, res) => {
    const id = Number(req.params.id)
    //@ts-ignore
    const userId = req.userId; 
    try {
    const room = await prismaClient.room.findUnique({where : {id}})
    if(!room) return res.status(404).send({message : "Not found "})
    else if(room.adminId !== userId) {
        return res.status(403).send({message : "not ur room"})
    } else {
        try {
            await prismaClient.shape.deleteMany({ where: { roomId: id } });
            await prismaClient.room.delete({ where: { id } });
        } catch (err) {
            return res.send({message : "Error deleting Message "})
        }
    }
    } catch (err) {
console.log(err, err)
res.status(500).send({error : err})
}
})
app.patch("/room/:id", isLoggedIn, async (req, res) => {
    const id = Number(req.params.id);            // ← convert
    if (Number.isNaN(id)) {                       // ← now this check actually works
      return res.status(400).send({ message: "Invalid id" });
    }
  
    // @ts-ignore
    const userId = req.userId;
    const slug = req.body.slug;
  
    if (!slug || typeof slug !== "string") {
      return res.status(400).send({ message: "Invalid Slug" });
    }
  
    const room = await prismaClient.room.findUnique({ where: { id } });
    if (!room) return res.status(404).send({ message: "Not found" });
    if (room.adminId !== userId) {
      return res.status(403).send({ message: "Not your room" });
    }
  
    try {
      const updated = await prismaClient.room.update({
        where: { id },
        data: { slug },
        select: { id: true, slug: true },
      });
      res.send(updated);
    } catch (err: any) {
      if (err.code === "P2002") {
        return res.status(409).send({ message: "Slug already taken" });
      }
      console.error(err);
      res.status(500).send({ message: "Failed to rename" });
    }
  });

/* ════════════════════════════════════════════════════════════════════════
 * Image uploads
 *
 * Two small JSON calls around an upload this process never sees. The browser
 * sends the bytes straight to object storage with a presigned URL, so the API
 * never buffers a file, never pays for the bandwidth twice, and does not get
 * slower as images get bigger. Scaling the board and scaling image traffic
 * become separate problems.
 *
 * Images are addressed by the SHA-256 of their bytes, so the same picture is
 * stored once however many boards it lands on, and its URL can be cached
 * forever because a hash cannot come to mean different bytes.
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Ask for permission to upload one image.
 *
 * Answers one of two things: "already have it" - costing a re-paste a single
 * round trip instead of a megabyte - or a URL good for one PUT of these exact
 * bytes, for a few minutes.
 *
 * This is the only endpoint that hands out write access to the bucket, so the
 * body is validated strictly before anything is signed: the hash shape,
 * because it becomes the object key; the type, against an allowlist; and the
 * size, because the client's own limit is a courtesy rather than a control.
 */
app.post("/files/presign", isLoggedIn, async (req, res) => {
  const parsed = PresignUploadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).send({
      message: "Invalid upload request",
      issues: parsed.error.issues.map((i) => i.message),
    });
  }
  const { hash, mimeType, size } = parsed.data;

  try {
    const existing = await prismaClient.file.findUnique({ where: { hash } });
    if (existing) {
      // someone has already uploaded these exact bytes, here or on another
      // board: nothing to send, and nothing to write
      return res.send({
        exists: true,
        url: publicUrl(hash),
        width: existing.width,
        height: existing.height,
      });
    }

    const uploadUrl = await presignPut(hash, mimeType);
    return res.send({ exists: false, uploadUrl, maxBytes: MAX_IMAGE_BYTES, size });
  } catch (err) {
    console.error("[files] presign failed:", err);
    return res.status(500).send({ message: "Could not start the upload" });
  }
});

/**
 * Report that the upload finished, and get the row written.
 *
 * The claim is checked rather than believed: the object store is asked whether
 * the key exists and how big it is, and those answers - not the client's - are
 * what get stored. Without that, anyone could register rows for objects that
 * were never uploaded.
 *
 * Writing is idempotent. A retry after a dropped response finds the row
 * already there and succeeds, because the hash is the primary key and the
 * bytes behind it cannot have changed.
 */
app.post("/files/confirm", isLoggedIn, async (req, res) => {
  const parsed = ConfirmUploadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).send({ message: "Invalid confirmation" });
  }
  const { hash, width, height } = parsed.data;
  //@ts-ignore - set by isLoggedIn
  const userId: string = req.userId;

  try {
    const existing = await prismaClient.file.findUnique({ where: { hash } });
    if (existing) {
      return res.send({ url: publicUrl(hash), width: existing.width, height: existing.height });
    }

    const stored = await headObject(hash);
    if (!stored) {
      return res.status(409).send({ message: "That upload did not arrive" });
    }
    if (stored.size > MAX_IMAGE_BYTES) {
      return res.status(413).send({ message: "That image is too large" });
    }

    // Read the dimensions out of the stored header rather than believing the
    // ones in the body. HeadObject cannot report them - it decodes nothing -
    // so this is a ranged GET of the first few kilobytes.
    //
    // It matters more than it looks: a File row is written once and then
    // returned to every later upload of the same bytes, so a wrong value is
    // permanent and has no path to correction. The cost of a bad one is only
    // layout - the shape gets the wrong aspect and the bitmap is stretched into
    // it - but it is the last field in the pipeline that was taken on trust.
    //
    // A parse failure falls back to the client's numbers: an unrecognised
    // header is a reason to distrust the dimensions, not to reject an upload
    // whose bytes are already stored and verified by their hash.
    const prefix = await getObjectPrefix(hash, HEADER_BYTES);
    const measured = prefix ? readDimensions(prefix) : null;
    if (!measured) {
      console.warn(
        `[files] could not read dimensions for ${hash} (${stored.mimeType}); using the client's`
      );
    }
    const actualWidth = measured?.width ?? width;
    const actualHeight = measured?.height ?? height;

    await prismaClient.file.create({
      data: {
        hash,
        mimeType: stored.mimeType,
        size: stored.size,
        width: actualWidth,
        height: actualHeight,
        userId,
      },
    });

    return res.send({ url: publicUrl(hash), width: actualWidth, height: actualHeight });
  } catch (err: any) {
    // two tabs confirming the same paste at once: the loser of the race finds
    // the row already written, which is the outcome it wanted anyway
    if (err?.code === "P2002") {
      return res.send({ url: publicUrl(hash), width, height });
    }
    console.error("[files] confirm failed:", err);
    return res.status(500).send({ message: "Could not save that image" });
  }
});

// configurable so a second instance can be run alongside the dev one, for
// example to exercise a route against the real database without restarting it
// expired guests are unreachable accounts: swept so the table does not grow
// without bound, and so their usernames come back into circulation
startGuestSweeper();

app.listen(Number(process.env.PORT) || 3001)





