import { BookOpen, FlaskConical, Layers, PenTool } from "lucide-react";
import { ROLE_AUDIENCES } from "@/data/landingData";

const ROLE_ICONS = [BookOpen, PenTool, FlaskConical, Layers];

export function RoleShowcase() {
  return (
    <section id="roles" className="pw-workspace" aria-labelledby="roles-title">
      <div className="pw-workspace-intro">
        <div>
          <h2 id="roles-title">Planned tools for Teachers, Writers, Researchers &amp; Content Teams</h2>
          <p>The workspace roadmap brings Filipino lesson content, item review, and mastery reporting into one place.</p>
        </div>
        <img src="./landing/workspace.webp" alt="Illustrated Filipino learning workspace with a notebook and stationery" loading="lazy" />
      </div>
      <div className="pw-roles">
        {ROLE_AUDIENCES.map((item, index) => {
          const Icon = ROLE_ICONS[index];
          return (
            <article key={item.id} className="pw-role">
              <Icon aria-hidden="true" size={24} />
              <h3>{item.role}</h3>
              <p>{item.description}</p>
              <ul>
                {item.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}
              </ul>
            </article>
          );
        })}
      </div>
    </section>
  );
}
