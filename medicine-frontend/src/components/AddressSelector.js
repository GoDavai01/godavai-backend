import React from "react";
import { Box, Typography, Button, Chip, Stack, List, ListItem, ListItemIcon, ListItemText, IconButton } from "@mui/material";
import HomeIcon from "@mui/icons-material/Home";
import WorkIcon from "@mui/icons-material/Work";
import AddLocationAltIcon from "@mui/icons-material/AddLocationAlt";
import EditIcon from "@mui/icons-material/Edit";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DeleteIcon from "@mui/icons-material/Delete";

const ICONS = {
  Home: <HomeIcon sx={{ color: "#31c48d" }} />,
  Work: <WorkIcon sx={{ color: "#fea44d" }} />,
  Other: <AddLocationAltIcon sx={{ color: "#1976d2" }} />,
};

export default function AddressSelector({
  addresses = [],
  selectedAddressId,
  onSelect,
  onAddAddress,
  onEdit,
  onDelete, // NEW
}) {
  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
        Delivery Address
      </Typography>
      <List sx={{ bgcolor: "#23242c", borderRadius: 2, mb: 1 }}>
        {addresses.length === 0 && (
          <ListItem>
            <Button
              startIcon={<AddLocationAltIcon />}
              variant="contained"
              onClick={onAddAddress}
            >
              Add New Address
            </Button>
          </ListItem>
        )}
        {addresses.map((address) => (
          <ListItem
            key={address.id}
            selected={selectedAddressId === address.id}
            sx={{
              bgcolor: selectedAddressId === address.id ? "#272d38" : "inherit",
              borderRadius: 2,
              mb: 1,
              cursor: "pointer",
              transition: "0.2s",
            }}
            onClick={() => onSelect(address.id)}
            secondaryAction={
              <Box sx={{ display: "flex", alignItems: "center" }}>
                {selectedAddressId === address.id && (
                  <CheckCircleIcon sx={{ color: "#13C0A2", mr: 1 }} />
                )}
                <Button
                  variant="text"
                  size="small"
                  sx={{ color: "#31c48d", minWidth: 60 }}
                  startIcon={<EditIcon />}
                  onClick={e => {
                    e.stopPropagation();
                    onEdit(address);
                  }}
                >
                  Edit
                </Button>
                <IconButton
                  edge="end"
                  color="error"
                  sx={{ ml: 1 }}
                  onClick={e => {
                    e.stopPropagation();
                    if (onDelete) onDelete(address);
                  }}
                  aria-label="Delete Address"
                >
                  <DeleteIcon />
                </IconButton>
              </Box>
            }
          >
            <ListItemIcon>
              <Chip
                label={address.type}
                icon={ICONS[address.type] || ICONS["Other"]}
                sx={{ bgcolor: "#2d2f3a", color: "#fff", fontWeight: 600 }}
              />
            </ListItemIcon>
            <ListItemText
              primary={
                <span style={{ color: "#fff", fontWeight: 700 }}>{address.name}</span>
              }
              secondary={
                <>
                  <span style={{ color: "#cfd8dc" }}>{address.phone}</span>
                  <br />
                  <span style={{ color: "#cfd8dc" }}>
                    {address.addressLine}
                    {address.floor && `, Floor: ${address.floor}`}
                    {address.landmark && `, ${address.landmark}`}
                  </span>
                </>
              }
            />
          </ListItem>
        ))}
      </List>
      <Button
        startIcon={<AddLocationAltIcon />}
        variant="contained"
        color="primary"
        fullWidth
        onClick={onAddAddress}
      >
        Add New Address
      </Button>
    </Box>
  );
}
