export default function Home() {
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-800 mb-6">AFS Admin</h1>
        <div className="flex gap-4 justify-center">
          <a href="/supplies" className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700">
            소모품 관리 →
          </a>
          <a href="/hr" className="bg-emerald-600 text-white px-6 py-3 rounded-lg hover:bg-emerald-700">
            HR 관리 →
          </a>
        </div>
      </div>
    </main>
  )
}