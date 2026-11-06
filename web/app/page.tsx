import Link from 'next/link';

export default function Home() {
  return (
    <section className="home">
      <h1>The buyer only gets the goods when the seller gets paid — and no bank is needed.</h1>
      <p className="lede">
        Tradelock is documents-against-payment without a bank. The buyer&apos;s stablecoins sit in a NEAR contract; the supplier&apos;s electronic bill of lading sits at an
        address only that contract controls, through NEAR Chain Signatures. When the buyer accepts the documents, both are released together.
      </p>
      <ol className="steps">
        <li>The buyer proposes terms and funds the deal.</li>
        <li>The supplier hands the bill of lading to the deal&apos;s address on Sepolia.</li>
        <li>The buyer checks it on Sepolia, then accepts the documents (or refuses them).</li>
        <li>Payment goes to the supplier; the title goes to the buyer, signed by NEAR MPC.</li>
      </ol>
      <p>
        <Link className="btn btn-primary" href="/deals/new">Start a deal</Link> <Link className="btn" href="/demo">See the demo deals</Link>
      </p>
    </section>
  );
}
