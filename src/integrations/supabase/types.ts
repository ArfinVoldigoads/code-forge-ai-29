export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      agent_skills: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          instructions: string
          name: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          instructions: string
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          instructions?: string
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          created_at: string
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          created_at?: string
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          created_at?: string
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      ask_user_answers: {
        Row: {
          answers: Json
          ask_id: string
          chat_id: string
          created_at: string
          id: string
          skipped: boolean
        }
        Insert: {
          answers?: Json
          ask_id: string
          chat_id: string
          created_at?: string
          id?: string
          skipped?: boolean
        }
        Update: {
          answers?: Json
          ask_id?: string
          chat_id?: string
          created_at?: string
          id?: string
          skipped?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "ask_user_answers_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string
          detail: Json
          entity: string | null
          entity_id: string | null
          id: string
        }
        Insert: {
          action: string
          created_at?: string
          detail?: Json
          entity?: string | null
          entity_id?: string | null
          id?: string
        }
        Update: {
          action?: string
          created_at?: string
          detail?: Json
          entity?: string | null
          entity_id?: string | null
          id?: string
        }
        Relationships: []
      }
      chats: {
        Row: {
          created_at: string
          id: string
          model_id: string | null
          pinned: boolean
          sandbox_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          model_id?: string | null
          pinned?: boolean
          sandbox_id?: string | null
          title?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          model_id?: string | null
          pinned?: boolean
          sandbox_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chats_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "models"
            referencedColumns: ["id"]
          },
        ]
      }
      command_outputs: {
        Row: {
          chat_id: string | null
          command: string
          created_at: string
          duration_ms: number | null
          exit_code: number | null
          id: string
          sandbox_session_id: string | null
          source: string
          stderr: string
          stdout: string
          tool_execution_id: string | null
        }
        Insert: {
          chat_id?: string | null
          command: string
          created_at?: string
          duration_ms?: number | null
          exit_code?: number | null
          id?: string
          sandbox_session_id?: string | null
          source?: string
          stderr?: string
          stdout?: string
          tool_execution_id?: string | null
        }
        Update: {
          chat_id?: string | null
          command?: string
          created_at?: string
          duration_ms?: number | null
          exit_code?: number | null
          id?: string
          sandbox_session_id?: string | null
          source?: string
          stderr?: string
          stdout?: string
          tool_execution_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "command_outputs_sandbox_session_id_fkey"
            columns: ["sandbox_session_id"]
            isOneToOne: false
            referencedRelation: "sandbox_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "command_outputs_tool_execution_id_fkey"
            columns: ["tool_execution_id"]
            isOneToOne: false
            referencedRelation: "tool_executions"
            referencedColumns: ["id"]
          },
        ]
      }
      message_attachments: {
        Row: {
          chat_id: string
          created_at: string
          extracted_text: string | null
          file_name: string
          id: string
          message_id: string | null
          mime_type: string
          size_bytes: number
          storage_path: string
        }
        Insert: {
          chat_id: string
          created_at?: string
          extracted_text?: string | null
          file_name: string
          id?: string
          message_id?: string | null
          mime_type: string
          size_bytes: number
          storage_path: string
        }
        Update: {
          chat_id?: string
          created_at?: string
          extracted_text?: string | null
          file_name?: string
          id?: string
          message_id?: string | null
          mime_type?: string
          size_bytes?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_attachments_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_revisions: {
        Row: {
          content: string
          created_at: string
          id: string
          message_id: string
          revision: number
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          message_id: string
          revision: number
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          message_id?: string
          revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "message_revisions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          chat_id: string
          content: string
          created_at: string
          error: string | null
          events: Json
          id: string
          model_ref: string | null
          parent_message_id: string | null
          parts: Json
          planning: string | null
          request_id: string | null
          revision: number
          role: string
          seq: number
          status: string
          thinking: string | null
          updated_at: string
        }
        Insert: {
          chat_id: string
          content?: string
          created_at?: string
          error?: string | null
          events?: Json
          id?: string
          model_ref?: string | null
          parent_message_id?: string | null
          parts?: Json
          planning?: string | null
          request_id?: string | null
          revision?: number
          role: string
          seq?: number
          status?: string
          thinking?: string | null
          updated_at?: string
        }
        Update: {
          chat_id?: string
          content?: string
          created_at?: string
          error?: string | null
          events?: Json
          id?: string
          model_ref?: string | null
          parent_message_id?: string | null
          parts?: Json
          planning?: string | null
          request_id?: string | null
          revision?: number
          role?: string
          seq?: number
          status?: string
          thinking?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_parent_message_id_fkey"
            columns: ["parent_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      models: {
        Row: {
          context_window: number | null
          created_at: string
          description: string | null
          display_name: string
          enabled: boolean
          id: string
          is_default: boolean
          last_tested_at: string | null
          model_id: string
          provider_id: string | null
          sort_order: number
          status: string
          status_message: string | null
          updated_at: string
          vision: boolean
        }
        Insert: {
          context_window?: number | null
          created_at?: string
          description?: string | null
          display_name: string
          enabled?: boolean
          id?: string
          is_default?: boolean
          last_tested_at?: string | null
          model_id: string
          provider_id?: string | null
          sort_order?: number
          status?: string
          status_message?: string | null
          updated_at?: string
          vision?: boolean
        }
        Update: {
          context_window?: number | null
          created_at?: string
          description?: string | null
          display_name?: string
          enabled?: boolean
          id?: string
          is_default?: boolean
          last_tested_at?: string | null
          model_id?: string
          provider_id?: string | null
          sort_order?: number
          status?: string
          status_message?: string | null
          updated_at?: string
          vision?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "models_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      project_secrets: {
        Row: {
          chat_id: string
          created_at: string
          description: string | null
          id: string
          name: string
          status: string
          updated_at: string
          value: string | null
        }
        Insert: {
          chat_id: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          status?: string
          updated_at?: string
          value?: string | null
        }
        Update: {
          chat_id?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          status?: string
          updated_at?: string
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_secrets_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
        ]
      }
      providers: {
        Row: {
          api_key: string | null
          base_url: string | null
          created_at: string
          enabled: boolean
          id: string
          last_tested_at: string | null
          name: string
          org_id: string | null
          status: string
          status_message: string | null
          type: string | null
          updated_at: string
        }
        Insert: {
          api_key?: string | null
          base_url?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          last_tested_at?: string | null
          name: string
          org_id?: string | null
          status?: string
          status_message?: string | null
          type?: string | null
          updated_at?: string
        }
        Update: {
          api_key?: string | null
          base_url?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          last_tested_at?: string | null
          name?: string
          org_id?: string | null
          status?: string
          status_message?: string | null
          type?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      runs: {
        Row: {
          chat_id: string
          created_at: string
          id: string
          last_error: string | null
          last_heartbeat: string
          lease_until: string
          message_id: string | null
          request_id: string
          round: number
          status: string
          updated_at: string
        }
        Insert: {
          chat_id: string
          created_at?: string
          id?: string
          last_error?: string | null
          last_heartbeat?: string
          lease_until?: string
          message_id?: string | null
          request_id: string
          round?: number
          status?: string
          updated_at?: string
        }
        Update: {
          chat_id?: string
          created_at?: string
          id?: string
          last_error?: string | null
          last_heartbeat?: string
          lease_until?: string
          message_id?: string | null
          request_id?: string
          round?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "runs_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
        ]
      }
      sandbox_files: {
        Row: {
          action: string
          created_at: string
          id: string
          path: string
          sandbox_session_id: string
          size_bytes: number | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          path: string
          sandbox_session_id: string
          size_bytes?: number | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          path?: string
          sandbox_session_id?: string
          size_bytes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sandbox_files_sandbox_session_id_fkey"
            columns: ["sandbox_session_id"]
            isOneToOne: false
            referencedRelation: "sandbox_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      sandbox_sessions: {
        Row: {
          chat_id: string | null
          created_at: string
          id: string
          last_active_at: string
          metadata: Json
          sandbox_id: string
          status: string
          template: string | null
        }
        Insert: {
          chat_id?: string | null
          created_at?: string
          id?: string
          last_active_at?: string
          metadata?: Json
          sandbox_id: string
          status?: string
          template?: string | null
        }
        Update: {
          chat_id?: string | null
          created_at?: string
          id?: string
          last_active_at?: string
          metadata?: Json
          sandbox_id?: string
          status?: string
          template?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sandbox_sessions_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
        ]
      }
      tool_executions: {
        Row: {
          chat_id: string
          created_at: string
          duration_ms: number | null
          error: string | null
          id: string
          input: Json
          message_id: string | null
          output: Json | null
          status: string
          tool_name: string
        }
        Insert: {
          chat_id: string
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          input?: Json
          message_id?: string | null
          output?: Json | null
          status?: string
          tool_name: string
        }
        Update: {
          chat_id?: string
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          input?: Json
          message_id?: string | null
          output?: Json | null
          status?: string
          tool_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "tool_executions_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_executions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
