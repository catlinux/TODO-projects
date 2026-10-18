import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { peticion } from "./api";

export function useCerrarSesion() {
  const cliente = useQueryClient();
  const navigate = useNavigate();

  return useMutation({
    mutationFn: async () => {
      await peticion("/auth/logout", { method: "POST" });
    },
    onSuccess: () => {
      cliente.clear();
      navigate("/login");
    },
  });
}
