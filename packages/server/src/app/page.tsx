/**
 * The landing page exists to hand out the install command. The product is the
 * terminal; this is a signpost, not an app.
 */
export default function Home() {
  return (
    <main style={{ textAlign: "center", padding: "2rem", lineHeight: 1.7 }}>
      <h1 style={{ letterSpacing: "0.2em", fontSize: "1.6rem", margin: 0 }}>X ARCADE</h1>
      <p style={{ color: "#6a7490", margin: "0.5rem 0 2rem" }}>
        daily mini-games for the dead minutes while your agent works
      </p>
      <code
        style={{
          display: "inline-block",
          padding: "0.8rem 1.4rem",
          border: "1px solid #343a50",
          borderRadius: 8,
          background: "#12141c",
          fontSize: "1.05rem",
        }}
      >
        npx x-arcade
      </code>
      <p style={{ color: "#6a7490", marginTop: "2rem", fontSize: "0.85rem" }}>
        same maze, same apples, everyone, every day
      </p>
    </main>
  );
}
