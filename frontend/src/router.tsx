import { createBrowserRouter, Navigate } from "react-router-dom"
import AppLayout from "@/layouts/AppLayout"
import DashboardPage from "@/pages/DashboardPage"
import SurveysPage from "@/pages/SurveysPage"
import SurveyDetailPage from "@/pages/SurveyDetailPage"
import DetectionsPage from "@/pages/DetectionsPage"
import SettingsPage from "@/pages/SettingsPage"
import LoginPage from "@/pages/LoginPage"
import SignupPage from "@/pages/SignupPage"
import ColonySettingsPage from "@/pages/ColonySettingsPage"
import { ProtectedRoute } from "@/components/ProtectedRoute"

export const router = createBrowserRouter([
    {
        path: "/login",
        element: <LoginPage />,
    },
    {
        path: "/signup",
        element: <SignupPage />,
    },
    {
        path: "/",
        element: (
            <ProtectedRoute>
                <AppLayout />
            </ProtectedRoute>
        ),
        children: [
            {
                index: true,
                element: <Navigate to="/dashboard" replace />,
            },
            {
                path: "dashboard",
                element: <DashboardPage />,
            },
            {
                path: "surveys",
                element: <SurveysPage />,
            },
            {
                path: "surveys/:surveyId",
                element: <SurveyDetailPage />,
            },
            {
                path: "detections",
                element: <DetectionsPage />,
            },
            {
                path: "settings",
                element: <SettingsPage />,
            },
            {
                path: "colony/settings",
                element: <ColonySettingsPage />,
            },
        ],
    },
])
