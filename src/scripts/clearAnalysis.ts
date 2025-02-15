import { PrismaClient } from "@prisma/client";

async function clearAnalysis() {
  const prisma = new PrismaClient();
  try {
    const deleteResult = await prisma.commitAnalysis.deleteMany({});
    console.log(
      `Deleted ${deleteResult.count} records from CommitAnalysis table`
    );
  } catch (error) {
    console.error("Error clearing CommitAnalysis table:", error);
  } finally {
    await prisma.$disconnect();
  }
}

clearAnalysis();
