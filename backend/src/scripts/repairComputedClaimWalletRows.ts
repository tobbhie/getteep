import "dotenv/config";
import { getDb, getPool } from "../db/database";

async function main() {
  const db = getDb();
  const rows = await db
    .prepare(
      `SELECT author_id, wallet_address, owner_address, deployed_at_block, tx_hash
       FROM claim_wallets
       WHERE deployed_at_block = 0
         AND COALESCE(tx_hash, '') = ''
       ORDER BY created_at ASC`
    )
    .all<{
      author_id: string;
      wallet_address: string;
      owner_address: string;
      deployed_at_block: string | number;
      tx_hash: string;
    }>();

  const result = await db.transaction(async (txDb) => {
    let archived = 0;
    let deleted = 0;
    for (const row of rows) {
      const archive = await txDb
        .prepare(
          `INSERT INTO claim_wallet_legacy (author_id, wallet_address)
           VALUES (?, ?)
           ON CONFLICT(author_id, wallet_address) DO NOTHING`
        )
        .run(row.author_id, row.wallet_address.toLowerCase());
      archived += archive.changes;

      const removal = await txDb
        .prepare(
          `DELETE FROM claim_wallets
           WHERE author_id = ?
             AND LOWER(wallet_address) = LOWER(?)
             AND deployed_at_block = 0
             AND COALESCE(tx_hash, '') = ''`
        )
        .run(row.author_id, row.wallet_address);
      deleted += removal.changes;
    }
    return { archived, deleted };
  })();

  console.log(JSON.stringify({
    scanned: rows.length,
    archivedLegacyRows: result.archived,
    deletedComputedRows: result.deleted,
    affected: rows.map((row) => ({
      authorId: row.author_id,
      walletAddress: row.wallet_address.toLowerCase(),
      ownerAddress: row.owner_address.toLowerCase(),
    })),
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getPool().end();
  });
