// Runs on Vercel before `next build`: the production DATABASE_URL is a sensitive
// variable that only the build can read, so migrations are applied here.
// SEED_DEMO=1 (set for one build with `vercel deploy --build-env SEED_DEMO=1`) also
// re-creates the fictional demo class.
import { migrate } from "./migrate";
import { seedDemo } from "./seed-demo";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("[vercel-build] DATABASE_URL not set; skipping migrations");
    return;
  }
  await migrate(url);
  if (process.env.SEED_DEMO === "1") {
    const r = await seedDemo(url);
    console.log(`[vercel-build] seeded ${r.students} demo students (join code ${r.joinCode})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
