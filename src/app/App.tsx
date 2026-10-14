import { Navigate, createHashRouter, useParams } from "react-router";
import { RouterProvider } from "react-router/dom";
import { PreInspectionScreen } from "../features/inspections/InspectionHome";
import { tabPath } from "../features/inspections/tabPath";
import { DashboardPage } from "../features/inspections/DashboardPage";
import { InspectionsPage } from "../features/inspections/InspectionsPage";
import { ProjectPage } from "../features/projects/ProjectPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { DocumentScreen } from "../features/drawings/DocumentScreen";
import { MemoScreen } from "../features/memo/MemoScreen";
import { Shell } from "./Shell";

// Hash routing: GitHub Pages has no SPA fallback, and every route is served
// by the one precached index.html.
const router = createHashRouter([
  {
    element: <Shell />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "inspections", element: <InspectionsPage /> },
      // An inspection opens on its Inspection tab (SPEC section 12).
      { path: "inspections/:id", element: <OpenInspection /> },
      { path: "inspections/:id/details", element: <PreInspectionScreen /> },
      // The Inspection step is the drawings themselves.
      { path: "inspections/:id/inspection", element: <DocumentScreen /> },
      { path: "projects/:id", element: <ProjectPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "inspections/:id/document", element: <DocumentScreen /> },
      { path: "inspections/:id/memo", element: <MemoScreen /> },
    ],
  },
]);

function OpenInspection() {
  const { id = "" } = useParams();
  return <Navigate to={tabPath(id, "inspection")} replace />;
}

export function App() {
  return <RouterProvider router={router} />;
}
