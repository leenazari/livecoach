import MatrixRain from "@/components/MatrixRain";

export default function CallLoading() {
  return (
    <main className="relative z-10 mx-auto max-w-[1180px] px-4 py-8 sm:px-5">
      <MatrixRain
        size="page"
        messages={[
          "loading call workspace",
          "linking the right conversation",
          "preparing your call context",
        ]}
      />
    </main>
  );
}
