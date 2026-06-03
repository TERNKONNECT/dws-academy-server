variable "aws_region" {
  description = "The AWS region to deploy to"
  type        = string
  default     = "eu-north-1"
}

variable "project_name" {
  description = "Name of the project"
  type        = string
  default     = "dws-academy-backend"
}

variable "db_username" {
  description = "Master username for the database"
  type        = string
  default     = "dwspostgres"
}

variable "db_name" {
  description = "Initial database name to create"
  type        = string
  default     = "dwsacademy"
}
