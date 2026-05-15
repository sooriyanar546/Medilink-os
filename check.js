const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://neondb_owner:npg_lB94CdkINRts@ep-broad-dream-apb48tjt.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require' });
client.connect().then(async () => {
  const res = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name='ClinicalNote'");
  console.log(res.rows);
  client.end();
}).catch(e => console.error(e));
