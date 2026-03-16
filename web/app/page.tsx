export default function HomePage() {
  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold text-slate-900">Axya Web</h1>
      <p className="mt-2 text-slate-600">Open a public share via /s/&lt;slug&gt;?k=&lt;secret&gt;.</p>
      <a
        href="/folders"
        className="mt-5 inline-flex rounded-full bg-[#5B7CFF] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#4B6EF5]"
      >
        Open Folders UI Demo
      </a>
    </main>
  );
}
