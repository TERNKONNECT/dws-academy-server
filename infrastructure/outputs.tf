output "db_host" {
  description = "The database host address"
  value       = aws_db_instance.postgres.address
}

output "db_port" {
  description = "The database port"
  value       = aws_db_instance.postgres.port
}

output "db_username" {
  description = "The database username"
  value       = aws_db_instance.postgres.username
}

output "db_password" {
  description = "The generated database password"
  value       = random_password.db_password.result
  sensitive   = true
}

output "database_url" {
  description = "The full connection string to place in your .env file"
  value       = "postgres://${aws_db_instance.postgres.username}:${random_password.db_password.result}@${aws_db_instance.postgres.address}:${aws_db_instance.postgres.port}/${var.db_name}"
  sensitive   = true
}
