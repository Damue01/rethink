import { createBrowserRouter, Navigate } from "react-router";
import { RootLayout } from "./components/RootLayout";
import { Dashboard } from "./components/Dashboard";
import { ChatPage } from "./components/ChatPage";
import { ComparePage } from "./components/ComparePage";
import { ReviewPage } from "./components/ReviewPage";
import { DebatePage } from "./components/DebatePage";
import { SettingsLayout } from "./components/SettingsLayout";
import { SettingsModels } from "./components/SettingsModels";
import { SettingsRoles } from "./components/SettingsRoles";
import { SettingsSkills } from "./components/SettingsSkills";
import { SettingsMethodologies } from "./components/SettingsMethodologies";
import { SettingsMCP } from "./components/SettingsMCP";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: RootLayout,
    children: [
      { index: true, Component: Dashboard },
      { path: "chat/:id", Component: ChatPage },
      { path: "compare", element: <Navigate to="/compare/new" replace /> },
      { path: "compare/:id", Component: ComparePage },
      { path: "review/:id", Component: ReviewPage },
      { path: "debate/:id", Component: DebatePage },
      {
        path: "settings",
        Component: SettingsLayout,
        children: [
          { path: "models", Component: SettingsModels },
          { path: "roles", Component: SettingsRoles },
          { path: "skills", Component: SettingsSkills },
          { path: "methodologies", Component: SettingsMethodologies },
          { path: "mcp", Component: SettingsMCP },
        ],
      },
    ],
  },
]);
