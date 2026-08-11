import MatrixRain from "@/components/MatrixRain";

export default function CrmLoading() {
  return (
    <main className="relative z-10 mx-auto max-w-[1100px] px-4 py-8 sm:px-5">
      <MatrixRain
        size="page"
        messages={[
          "loading your CRM",
          "checking today's priorities",
          "assembling the latest picture",
        ]}
      />
    </main>
  );
}
